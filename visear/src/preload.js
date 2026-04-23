const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  setCredentials: (apiKey, endpoint, openaiApiKey) => ipcRenderer.invoke('credentials:set', apiKey, endpoint, openaiApiKey),
  getStoredCredentials: () => ipcRenderer.invoke('credentials:get'),
  checkDatabase: () => ipcRenderer.invoke('check:database'),
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  processImages: (dirPath) => ipcRenderer.invoke('process:images', dirPath),
  onProcessProgress: (callback) => ipcRenderer.on('process:progress', (_, progress) => callback(progress)),
  getDirectories: () => ipcRenderer.invoke('get:directories'),
  searchImages: (query, checkRelevance, selectedDirectory, limit, offset = 0) => 
    ipcRenderer.invoke('search:images', query, checkRelevance, selectedDirectory, limit, offset),
  enhancePrompt: (prompt) => ipcRenderer.invoke('enhance:prompt', prompt),
  onSearchProgress: (callback) => ipcRenderer.on('search:progress', (_, progress) => callback(progress)),
  dropDirectory: (directory) => ipcRenderer.invoke('drop:directory', directory)
}) 