const fs = require('fs/promises');
const config = require('../config');
const { convertToBase64 } = require('./convert');

async function sendRequest(endpoint, payload) {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.getApiKey()}`
    };
    
    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`API request failed(${response.status}): ${text}`);
    }
    
    return JSON.parse(text);
}

async function getEndpointIdentifier() {
    const endpoint = config.getEndpoint();
    return endpoint.split('/').slice(-2)[0];
}

async function checkAvailableWorkers() {
    const apiKey = config.getApiKey();
    const endpointId = await getEndpointIdentifier();
    const healthUrl = `https://api.runpod.ai/v2/${endpointId}/health`;
    
    const response = await fetch(healthUrl, { 
        headers: { 'Authorization': `Bearer ${apiKey}` } 
    });
    const health = await response.json();
    return (health.workers.idle || 0) + (health.workers.running || 0);
}

async function checkJobStatus(jobId) {
    const apiKey = config.getApiKey();
    const endpointId = await getEndpointIdentifier();
    const statusUrl = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;
    
    const response = await fetch(statusUrl, { 
        headers: { 'Authorization': `Bearer ${apiKey}` } 
    });
    
    if (!response.ok) {
        throw new Error(`Job status check failed: ${await response.text()}`);
    }
    
    const result = await response.json();
    const status = result.status;
    
    if (status === 'COMPLETED') {
        return { completed: true, success: true, output: result.output };
    }
    
    if (status === 'FAILED' || status === 'CANCELLED') {
        return {
            completed: true,
            success: false,
            error: status === 'CANCELLED' ? 'Job was cancelled' : (result.error || 'Job processing failed')
        };
    }
    
    return { completed: false };
}

async function checkEndpointStatus() {
    const apiKey = config.getApiKey();
    const endpoint = config.getEndpoint();
    
    if (!apiKey || !endpoint) {
        return false;
    }
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                input: { ping: true }
            })
        });
        
        const result = await response.json();
        return result.id ? true : false;
    } catch (error) {
        return false;
    }
}

async function imageProcessing(base64Image) {
    return await sendRequest(config.getEndpoint(), {
        input: {
            process_image: base64Image
        }
    });
}

async function relevanceCheck(base64Image, query) {
    return await sendRequest(config.getEndpoint(), {
        input: {
            check_relevance: base64Image,
            query: query
        }
    });
}

async function runBatchedJobs({
    items,
    label,
    submitJob,
    handleCompletion,
    handleSubmitError,
    handleCheckError,
    onProgress
}) {
    const totalWorkers = await checkAvailableWorkers();
    let workerCount = Math.min(2, totalWorkers);
    let lastRampTime = Date.now();
    const totalItems = items.length;

    console.log(`⏳ ${label} using ${workerCount} / ${totalWorkers} workers.\n`);

    const results = [];
    const activeJobs = new Map();
    const pendingItems = [...items];
    let processedCount = 0;

    const pushResult = (r) => { if (r != null) results.push(r); };
    const reportProgress = () => { if (onProgress) onProgress(processedCount, totalItems); };

    const startBatch = async () => {
        const now = Date.now();
        if (workerCount < totalWorkers && now - lastRampTime >= 10000) {
            workerCount = Math.min(workerCount + 2, totalWorkers);
            lastRampTime = now;
            console.log(`\n🚀 Ramping up to ${workerCount} / ${totalWorkers} workers.\n`);
        }

        while (activeJobs.size < workerCount && pendingItems.length > 0) {
            const item = pendingItems.shift();
            try {
                const { id, context } = await submitJob(item);
                activeJobs.set(id, { context, startTime: Date.now() });
            } catch (error) {
                pushResult(handleSubmitError(item, error));
                processedCount++;
                reportProgress();
            }
        }
    };

    await startBatch();

    while (activeJobs.size > 0 || pendingItems.length > 0) {
        const jobsToCheck = Array.from(activeJobs.entries());

        for (const [jobId, jobData] of jobsToCheck) {
            try {
                const status = await checkJobStatus(jobId);

                if (status.completed) {
                    activeJobs.delete(jobId);
                    processedCount++;
                    reportProgress();
                    pushResult(handleCompletion(jobData.context, status));
                    if (pendingItems.length > 0) await startBatch();
                }
            } catch (error) {
                activeJobs.delete(jobId);
                processedCount++;
                reportProgress();
                pushResult(handleCheckError(jobData.context, error));
            }
        }

        if (activeJobs.size > 0) {
            await new Promise(resolve => setTimeout(resolve, config.constants.POLL_INTERVAL_MS));
        }
    }

    return results;
}

async function processBatch(imagePaths, progressCallback = null) {
    const results = await runBatchedJobs({
        items: imagePaths,
        label: `Processing ${imagePaths.length} images`,
        submitJob: async (imagePath) => {
            const base64Image = await convertToBase64(imagePath);
            const jobInfo = await imageProcessing(base64Image);
            return { id: jobInfo.id, context: { imagePath, base64Image } };
        },
        handleCompletion: ({ imagePath, base64Image }, status) => {
            if (status.success) {
                console.log(`✅ Processed image: ${imagePath}`);
                return { imagePath, base64Image, success: true, ...status.output };
            }
            return { imagePath, success: false, error: status.error || 'Unknown error' };
        },
        handleSubmitError: (imagePath, error) => {
            console.error(`Error processing ${imagePath}: ${error.message}`);
            return { imagePath, success: false, error: `Error: ${error.message}` };
        },
        handleCheckError: ({ imagePath }, error) => {
            console.error(`Error checking job for ${imagePath}: ${error.message}`);
            return { imagePath, success: false, error: `Job check error: ${error.message}` };
        },
        onProgress: progressCallback
    });

    console.log(`✅ Processing complete for ${results.length} images.`);
    return results;
}

async function batchRelevance(imageResults, query, progressCallback = null) {
    return runBatchedJobs({
        items: imageResults,
        label: `Checking relevance of ${imageResults.length} images`,
        submitJob: async (imageResult) => {
            const jobInfo = await relevanceCheck(imageResult.image, query);
            return { id: jobInfo.id, context: { imageResult } };
        },
        handleCompletion: ({ imageResult }, status) => {
            if (status.success && status.output.success && status.output.is_relevant) {
                console.log(`✅ Relevant`);
                return imageResult;
            }
            console.log(`❌ Not relevant`);
            return null;
        },
        handleSubmitError: (imageResult, error) => {
            console.error(`Error submitting relevance job for ${imageResult.path}: ${error.message}`);
            return null;
        },
        handleCheckError: ({ imageResult }, error) => {
            console.error(`Error checking relevance job for ${imageResult.path}: ${error.message}`);
            return null;
        },
        onProgress: progressCallback
    });
}

module.exports = {
    checkEndpointStatus,
    checkAvailableWorkers,
    sendRequest,
    imageProcessing,
    processBatch,
    relevanceCheck,
    batchRelevance,
    checkJobStatus
};
