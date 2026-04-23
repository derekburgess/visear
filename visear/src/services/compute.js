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
    static model = 'Xenova/bge-small-en-v1.5';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            let { pipeline, env } = await import('@huggingface/transformers');
            this.instance = await pipeline(this.task, this.model, {
                progress_callback,
                cache_dir: cacheDir
            });
        }
        return this.instance;
    }
}

const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

async function computeEmbedding(text, role = 'passage') {
    const extractor = await LocalEmbeddingPipeline.getInstance();
    const input = role === 'query' ? QUERY_PREFIX + text : text;
    return await extractor(input, { pooling: 'mean', normalize: true });
}

module.exports = {
    computeEmbedding,
    cacheDir
};