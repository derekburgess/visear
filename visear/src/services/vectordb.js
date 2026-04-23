const { LocalIndex } = require('vectra');
const path = require('path');
const fs = require('fs');
const os = require('os');

class VectorDB {
    constructor() {
        this.indices = {};
        this.indexPath = null;
        this.searchCache = null;
        this.maxCacheSize = 100;
        this.cacheKeys = [];
    }

    async initialize() {
        if (!this.indexPath) {
            let userDataPath;
            
            try {
                const electron = require('electron');
                const app = electron.app || electron.remote.app;
                userDataPath = app.getPath('userData');
            } catch (error) {
                const homeDir = os.homedir();
                if (process.platform === 'darwin') {
                    userDataPath = path.join(homeDir, 'Library/Application Support/Visear');
                } else if (process.platform === 'linux') {
                    userDataPath = path.join(homeDir, '.config/visear');
                } else {
                    userDataPath = path.join(homeDir, 'AppData/Roaming/Visear');
                }
            }

            if (!fs.existsSync(userDataPath)) {
                fs.mkdirSync(userDataPath, { recursive: true, mode: 0o755 });
            }

            this.indexPath = path.join(userDataPath, 'assetdb');
            
            if (!fs.existsSync(this.indexPath)) {
                fs.mkdirSync(this.indexPath, { recursive: true, mode: 0o755 });
            }
        }
    }

    async getOrCreateIndex(directory) {
        if (Array.isArray(directory)) {
            if (directory.length === 0) {
                return null;
            }
            directory = directory[0];
        }
        
        if (!directory) {
            return null;
        }
        
        const cleanDir = directory.startsWith('/') ? directory.substring(1) : directory;
        const sanitizedDir = cleanDir.replace(/[\/\\:*?"<>|]/g, '_');
        
        const dirIndexPath = path.join(this.indexPath, sanitizedDir);
        if (!fs.existsSync(dirIndexPath)) {
            fs.mkdirSync(dirIndexPath, { recursive: true, mode: 0o755 });
        }
        
        if (!this.indices[directory] || !fs.existsSync(path.join(dirIndexPath, 'index.json'))) {
            try {
                this.indices[directory] = new LocalIndex(dirIndexPath);
                
                if (!await this.indices[directory].isIndexCreated()) {
                    await this.indices[directory].createIndex();
                }
            } catch (error) {
                console.error(`Error creating index for ${directory}:`, error);
                if (fs.existsSync(dirIndexPath)) {
                    try {
                        const files = fs.readdirSync(dirIndexPath);
                        for (const file of files) {
                            fs.unlinkSync(path.join(dirIndexPath, file));
                        }
                    } catch (e) {
                        console.error(`Error cleaning up index files: ${e.message}`);
                    }
                }
                
                fs.mkdirSync(dirIndexPath, { recursive: true, mode: 0o755 });
                this.indices[directory] = new LocalIndex(dirIndexPath);
                await this.indices[directory].createIndex();
            }
        }
        
        return this.indices[directory];
    }

    async storeImage(filePath, imageBase64, description, textEmbedding, imageEmbedding) {
        await this.initialize();
        const directory = path.dirname(filePath).split(path.sep).pop();
        const index = await this.getOrCreateIndex(directory);
        
        const metadata = { 
            directory,
            filePath,
            image: imageBase64, 
            description,
            imageEmbedding: imageEmbedding
        };
        
        await index.insertItem({
            vector: textEmbedding,
            metadata
        });
    }

    async checkIndex() {
        await this.initialize();
        const directories = await this.getDirectories();
        let totalCount = 0;
        
        for (const dir of directories) {
            const index = await this.getOrCreateIndex(dir);
            const items = await index.listItems();
            totalCount += items.length;
        }
        
        return totalCount;
    }

    manageCache(key, value) {
        if (!this.searchCache) {
            this.searchCache = {};
            this.cacheKeys = [];
        }
        
        const existingIndex = this.cacheKeys.indexOf(key);
        if (existingIndex !== -1) {
            this.cacheKeys.splice(existingIndex, 1);
        }
        
        this.cacheKeys.unshift(key);
        
        this.searchCache[key] = {
            timestamp: Date.now(),
            results: value
        };
        
        while (this.cacheKeys.length > this.maxCacheSize) {
            const oldestKey = this.cacheKeys.pop();
            delete this.searchCache[oldestKey];
        }
        
        return value;
    }

    async search(queryEmbedding, limit = 20, selectedDirectories = null, queryText = '', offset = 0) {
        const directoryKey = Array.isArray(selectedDirectories) ? 
            selectedDirectories.sort().join(',') : 
            selectedDirectories;
        
        const fullCacheKey = JSON.stringify({
            query: queryText, 
            directory: directoryKey, 
            limit, 
            offset
        });
        
        if (this.searchCache && this.searchCache[fullCacheKey] && 
            Date.now() - this.searchCache[fullCacheKey].timestamp < 300000) {
            
            const cachedResults = this.searchCache[fullCacheKey].results;
            const existingIndex = this.cacheKeys.indexOf(fullCacheKey);
            if (existingIndex !== -1) {
                this.cacheKeys.splice(existingIndex, 1);
                this.cacheKeys.unshift(fullCacheKey);
            }
            
            return cachedResults;
        }
        
        await this.initialize();
        let allResults = [];
        
        const estimatedLimit = limit * 3 + offset;
        
        if (selectedDirectories) {
            if (Array.isArray(selectedDirectories)) {
                if (selectedDirectories.length === 0) {
                    const directories = await this.getDirectories();
                    const perDirectoryLimit = Math.ceil(Math.min(estimatedLimit, 500) / Math.max(1, directories.length));
                    
                    for (const dir of directories) {
                        const index = await this.getOrCreateIndex(dir);
                        if (!index) continue;
                        
                        const textResults = await index.queryItems(queryEmbedding, perDirectoryLimit);
                        const dirResults = textResults.map(result => ({
                            ...result,
                            directory: dir
                        }));
                        allResults = allResults.concat(dirResults);
                    }
                } else {
                    const perDirectoryLimit = Math.ceil(Math.min(estimatedLimit, 500) / Math.max(1, selectedDirectories.length));
                    
                    for (const dir of selectedDirectories) {
                        const index = await this.getOrCreateIndex(dir);
                        if (!index) continue;
                        
                        const textResults = await index.queryItems(queryEmbedding, perDirectoryLimit);
                        const dirResults = textResults.map(result => ({
                            ...result,
                            directory: dir
                        }));
                        allResults = allResults.concat(dirResults);
                    }
                }
            } else {
                const index = await this.getOrCreateIndex(selectedDirectories);
                if (index) {
                    const textResults = await index.queryItems(queryEmbedding, Math.min(estimatedLimit, 500));
                    allResults = textResults.map(result => ({
                        ...result,
                        directory: selectedDirectories
                    }));
                }
            }
        } else {
            const directories = await this.getDirectories();
            const perDirectoryLimit = Math.ceil(Math.min(estimatedLimit, 500) / Math.max(1, directories.length));
            
            for (const dir of directories) {
                const index = await this.getOrCreateIndex(dir);
                if (!index) continue;
                
                const textResults = await index.queryItems(queryEmbedding, perDirectoryLimit);
                const dirResults = textResults.map(result => ({
                    ...result,
                    directory: dir
                }));
                allResults = allResults.concat(dirResults);
            }
        }
        
        if (allResults.length === 0) {
            return [];
        }
        
        allResults.sort((a, b) => b.score - a.score);
        const bestMatch = allResults[0].item;
        const bestImageEmbedding = bestMatch.metadata.imageEmbedding;
        
        const cosineSimilarity = (vecA, vecB) => {
            const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
            const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
            const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
            return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
        };
        
        const levenshteinDistance = (a, b) => {
            if (a.length === 0) return b.length;
            if (b.length === 0) return a.length;
            
            const matrix = Array(a.length + 1).fill().map(() => Array(b.length + 1).fill(0));
            
            for (let i = 0; i <= a.length; i++) {
                matrix[i][0] = i;
            }
            
            for (let j = 0; j <= b.length; j++) {
                matrix[0][j] = j;
            }
            
            for (let i = 1; i <= a.length; i++) {
                for (let j = 1; j <= b.length; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j - 1] + cost
                    );
                }
            }
            
            return matrix[a.length][b.length];
        };
        
        const levenshteinSimilarity = (text1, text2) => {
            if (!text1 || !text2) return 0;
            const distance = levenshteinDistance(text1.toLowerCase(), text2.toLowerCase());
            const maxLength = Math.max(text1.length, text2.length);
            return maxLength > 0 ? 1 - (distance / maxLength) : 1;
        };
        
        const results = [];
        for (const textResult of allResults) {
            const imageEmbedding = textResult.item.metadata.imageEmbedding;
            const imageScore = cosineSimilarity(imageEmbedding, bestImageEmbedding);
            
            let levenshteinScore = 0;
            if (queryText && queryText.length > 0) {
                levenshteinScore = levenshteinSimilarity(queryText, textResult.item.metadata.description);
            }

            const vectorWeight = 0.6;
            const imageWeight = 0.2;
            const levenshteinWeight = 0.2;
            
            const combinedScore = queryText 
                ? (textResult.score * vectorWeight) + (imageScore * imageWeight) + (levenshteinScore * levenshteinWeight)
                : (textResult.score * 0.7) + (imageScore * 0.3);
            
            results.push({
                directory: textResult.item.metadata.directory,
                path: textResult.item.metadata.filePath,
                image: textResult.item.metadata.image,
                description: textResult.item.metadata.description,
                similarity: combinedScore
            });
        }

        const maxScore = Math.max(...results.map(r => r.similarity));
        const minScore = Math.min(...results.map(r => r.similarity));
        const range = maxScore - minScore;

        const normalizedResults = results.map(result => ({
            ...result,
            similarity: range > 0 ? (result.similarity - minScore) / range : 1
        }));

        normalizedResults.sort((a, b) => b.similarity - a.similarity);
        
        const paginatedResults = normalizedResults.slice(offset, Math.min(offset + limit, normalizedResults.length));
        
        return this.manageCache(fullCacheKey, paginatedResults);
    }

    async getTotalCount(queryEmbedding, selectedDirectories = null, queryText = '') {
        await this.initialize();
        
        const directoryKey = Array.isArray(selectedDirectories) ? 
            selectedDirectories.sort().join(',') : 
            selectedDirectories;
        
        const fullCacheKey = JSON.stringify({
            query: queryText, 
            directory: directoryKey, 
            count: true
        });
        
        if (this.searchCache && this.searchCache[fullCacheKey] && 
            Date.now() - this.searchCache[fullCacheKey].timestamp < 300000) {
            return this.searchCache[fullCacheKey].results;
        }
        
        let totalCount = 0;
        
        if (selectedDirectories) {
            if (Array.isArray(selectedDirectories)) {
                if (selectedDirectories.length === 0) {
                    const directories = await this.getDirectories();
                    for (const dir of directories) {
                        const index = await this.getOrCreateIndex(dir);
                        if (!index) continue;
                        const textResults = await index.queryItems(queryEmbedding, 1000);
                        totalCount += textResults.length;
                    }
                } else {
                    for (const dir of selectedDirectories) {
                        const index = await this.getOrCreateIndex(dir);
                        if (!index) continue;
                        const textResults = await index.queryItems(queryEmbedding, 1000);
                        totalCount += textResults.length;
                    }
                }
            } else {
                const index = await this.getOrCreateIndex(selectedDirectories);
                if (index) {
                    const textResults = await index.queryItems(queryEmbedding, 1000);
                    totalCount = textResults.length;
                }
            }
        } else {
            const directories = await this.getDirectories();
            for (const dir of directories) {
                const index = await this.getOrCreateIndex(dir);
                if (!index) continue;
                const textResults = await index.queryItems(queryEmbedding, 1000);
                totalCount += textResults.length;
            }
        }
        
        if (!this.searchCache) this.searchCache = {};
        return this.manageCache(fullCacheKey, totalCount);
    }

    async getDirectories() {
        await this.initialize();
        
        try {
            const fs = require('fs').promises;
            const dirs = await fs.readdir(this.indexPath);
            
            const results = [];
            for (const dir of dirs) {
                const dirPath = path.join(this.indexPath, dir);
                try {
                    const stat = await fs.stat(dirPath);
                    if (stat.isDirectory()) {
                        results.push(dir);
                    }
                } catch (error) {
                    console.error(`Error checking ${dir}:`, error);
                }
            }
            
            return results;
        } catch (error) {
            console.error('Error reading directories:', error);
            return [];
        }
    }

    async dropDirectory(directory) {
        await this.initialize();
        
        const cleanDir = directory.startsWith('/') ? directory.substring(1) : directory;
        const sanitizedDir = cleanDir.replace(/[\/\\:*?"<>|]/g, '_');
        const dirIndexPath = path.join(this.indexPath, sanitizedDir);
        
        if (this.indices[directory]) {
            delete this.indices[directory];
        }
        
        try {
            const fs = require('fs');
            const fsPromises = fs.promises;
            
            if (!fs.existsSync(dirIndexPath)) {
                console.log(`Directory does not exist: ${dirIndexPath}`);
                return {
                    success: true,
                    count: 0,
                    message: `Directory does not exist: ${dirIndexPath}`
                };
            }
            
            const deleteDir = async (dirPath) => {
                try {
                    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
                    
                    for (const entry of entries) {
                        const fullPath = path.join(dirPath, entry.name);
                        if (entry.isDirectory()) {
                            await deleteDir(fullPath);
                        } else {
                            await fsPromises.unlink(fullPath);
                        }
                    }
                    
                    await fsPromises.rmdir(dirPath);
                } catch (err) {
                    console.error(`Error deleting directory contents: ${err.message}`);
                    throw err;
                }
            };
            
            await deleteDir(dirIndexPath);
            
            if (this.searchCache) {
                const keysToDelete = [];
                for (const key in this.searchCache) {
                    try {
                        const parsedKey = JSON.parse(key);
                        if (parsedKey.directory === directory || key.includes(`"directory":"${directory}"`)) {
                            keysToDelete.push(key);
                        }
                    } catch (e) {
                        if (key.includes(directory)) {
                            keysToDelete.push(key);
                        }
                    }
                }
                
                keysToDelete.forEach(key => {
                    delete this.searchCache[key];
                    const keyIndex = this.cacheKeys.indexOf(key);
                    if (keyIndex !== -1) {
                        this.cacheKeys.splice(keyIndex, 1);
                    }
                });
            }
            
            return {
                success: true,
                count: 1,
                message: `Successfully removed: ${directory}`
            };
        } catch (error) {
            console.error(`Error removing ${directory}:`, error);
            return {
                success: false,
                count: 0,
                message: `Error removing ${directory}: ${error.message}`
            };
        }
    }
}

module.exports = new VectorDB();