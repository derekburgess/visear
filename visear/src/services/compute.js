const path = require('path');
const { app } = require('electron');
const fs = require('fs');

const userDataPath = app.getPath('userData');
const cacheDir = path.join(userDataPath, 'transformers-cache');

if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

process.env.TRANSFORMERS_CACHE = cacheDir;

class LocalEmbeddingPipeline {
    static task = 'feature-extraction';
    static model = 'Xenova/all-MiniLM-L6-v2';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            let { pipeline, env } = await import('@xenova/transformers');
            this.instance = await pipeline(this.task, this.model, { 
                progress_callback,
                cache_dir: cacheDir
            });
        }
        return this.instance;
    }
}

async function computeEmbedding(text) {
    const extractor = await LocalEmbeddingPipeline.getInstance();
    return await extractor(text, { pooling: 'mean', normalize: true });
}

module.exports = {
    computeEmbedding,
    cacheDir
};