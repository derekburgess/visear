const Store = require('electron-store');
const store = new Store();

module.exports = {
  getEndpoint: () => {
    const endpoint = process.env.RUNPOD_ENDPOINT || store.get('runpod.endpoint') || '';
    return endpoint ? `https://api.runpod.ai/v2/${endpoint}/run` : null;
  },
  
  getApiKey: () => process.env.RUNPOD_API_KEY || store.get('runpod.apiKey') || '',
  
  isConfigured: () => {
    const endpoint = process.env.RUNPOD_ENDPOINT || store.get('runpod.endpoint');
    const apiKey = process.env.RUNPOD_API_KEY || store.get('runpod.apiKey');
    return !!(endpoint && apiKey);
  },
  
  constants: {
    POLL_MAX_ATTEMPTS: 60,
    POLL_INTERVAL_MS: 3000,
    MAX_CONCURRENT_WORKERS: process.env.MAX_WORKERS ? parseInt(process.env.MAX_WORKERS, 10) : 3
  }
}; 