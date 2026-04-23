const { contextBridge, ipcRenderer } = require('electron')

/**
 * @typedef {Object} StoredCredentials
 * @property {string} [apiKey] RunPod API key
 * @property {string} [endpoint] RunPod endpoint id
 * @property {string} [openaiApiKey] OpenAI API key, optional
 *
 * @typedef {Object} ConnectResult
 * @property {boolean} success
 * @property {string} [error]
 *
 * @typedef {Object} DatabaseStatus
 * @property {boolean} success
 * @property {boolean} exists true if any indexed items exist
 * @property {number} count total number of indexed items across all directories
 *
 * @typedef {Object} ProcessResult
 * @property {boolean} success
 * @property {number} [count] successfully processed images
 * @property {number} [failed] images that failed to process
 * @property {number} [total] total images found in the directory
 * @property {string} [error]
 *
 * @typedef {Object} SearchResult
 * @property {string} directory
 * @property {string} path file path on disk
 * @property {string} image base64-encoded JPEG
 * @property {string} description model-generated caption
 * @property {number} similarity 0..1, normalized within the current batch
 *
 * @typedef {Object} SearchResponse
 * @property {SearchResult[]} results
 * @property {number} total total matching items across the selected directories
 * @property {boolean} hasMore true if more results are available past this page
 *
 * @typedef {Object} EnhanceResult
 * @property {boolean} success
 * @property {string} [enhancedPrompt]
 * @property {string} [error]
 *
 * @typedef {Object} DropResult
 * @property {boolean} success
 * @property {number} count
 * @property {string} message
 */

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Save credentials and verify the RunPod endpoint is reachable.
   * @param {string} apiKey
   * @param {string} endpoint
   * @param {string} [openaiApiKey]
   * @returns {Promise<ConnectResult>}
   */
  setCredentials: (apiKey, endpoint, openaiApiKey) => ipcRenderer.invoke('credentials:set', apiKey, endpoint, openaiApiKey),

  /** @returns {Promise<StoredCredentials>} */
  getStoredCredentials: () => ipcRenderer.invoke('credentials:get'),

  /** @returns {Promise<DatabaseStatus>} */
  checkDatabase: () => ipcRenderer.invoke('check:database'),

  /** @returns {Promise<boolean>} true if at least one RunPod worker is idle or running right now */
  checkEndpoint: () => ipcRenderer.invoke('endpoint:check'),

  /** @returns {Promise<string|null>} selected directory path, or null if the user cancelled */
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

  /**
   * Caption and index every supported image in a directory.
   * @param {string} dirPath
   * @returns {Promise<ProcessResult>}
   */
  processImages: (dirPath) => ipcRenderer.invoke('process:images', dirPath),

  /** @param {(progress: number) => void} callback percentage 0..100 */
  onProcessProgress: (callback) => ipcRenderer.on('process:progress', (_, progress) => callback(progress)),

  /** @returns {Promise<string[]>} */
  getDirectories: () => ipcRenderer.invoke('get:directories'),

  /**
   * @param {string} query
   * @param {boolean} checkRelevance if true, runs a VLM relevance filter after vector search
   * @param {string[]|null} selectedDirectory subset to search, or null for all
   * @param {number} [limit]
   * @param {number} [offset]
   * @returns {Promise<SearchResponse>}
   */
  searchImages: (query, checkRelevance, selectedDirectory, limit, offset = 0) =>
    ipcRenderer.invoke('search:images', query, checkRelevance, selectedDirectory, limit, offset),

  /**
   * Rewrite a free-form query into a more specific search string via the OpenAI API.
   * @param {string} prompt
   * @returns {Promise<EnhanceResult>}
   */
  enhancePrompt: (prompt) => ipcRenderer.invoke('enhance:prompt', prompt),

  /** @param {(progress: number) => void} callback percentage 0..100 */
  onSearchProgress: (callback) => ipcRenderer.on('search:progress', (_, progress) => callback(progress)),

  /**
   * Delete an indexed directory and all its items. Irreversible.
   * @param {string} directory
   * @returns {Promise<DropResult>}
   */
  dropDirectory: (directory) => ipcRenderer.invoke('drop:directory', directory)
})
