const { app, BrowserWindow, ipcMain, dialog } = require('electron')
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = true
app.commandLine.appendSwitch('log-level', '3')
app.disableHardwareAcceleration()

const path = require('path')
const fs = require('fs/promises')
const { computeEmbedding } = require('./services/compute')
const { processBatch, batchRelevance, checkEndpointStatus, checkAvailableWorkers } = require('./services/jobs')
const vectordb = require('./services/vectordb')
const Store = require('electron-store')

const store = new Store()

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false
    },
    icon: path.join(__dirname, '../assets/appicon.png')
  })

  win.loadFile('src/index.html')
}

app.whenReady().then(async () => {
  createWindow()

  const apiKey = store.get('runpod.apiKey')
  const endpoint = store.get('runpod.endpoint')
  if (apiKey && endpoint) {
    process.env.RUNPOD_API_KEY = apiKey
    process.env.RUNPOD_ENDPOINT = endpoint
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('credentials:get', async () => {
  return {
    apiKey: store.get('runpod.apiKey'),
    endpoint: store.get('runpod.endpoint'),
    openaiApiKey: store.get('openai.apiKey')
  }
})

ipcMain.handle('credentials:set', async (event, apiKey, endpoint, openaiApiKey) => {
  store.set('runpod.apiKey', apiKey)
  store.set('runpod.endpoint', endpoint)
  
  if (openaiApiKey) {
    store.set('openai.apiKey', openaiApiKey)
  }
  
  process.env.RUNPOD_API_KEY = apiKey
  process.env.RUNPOD_ENDPOINT = endpoint

  const testEndpoint = `https://api.runpod.ai/v2/${endpoint}/run`
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  }
  
  try {
    const response = await fetch(testEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: { ping: true }
      })
    })
    
    const result = await response.json()
    
    if (result && result.id) {
      console.log('✅ Endpoint is ready')
      event.sender.send('python-backend:ready')
      return { success: true }
    } else {
      return { 
        success: false, 
        error: `API error: ${result.error || 'Unknown error'}`
      }
    }
  } catch (error) {
    return { 
      success: false, 
      error: `Connection error: ${error.message}`
    }
  }
})

ipcMain.handle('dialog:openDirectory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  
  return canceled ? null : filePaths[0]
})

ipcMain.handle('check:database', async () => {
  await vectordb.initialize()
  const count = await vectordb.checkIndex()
  
  return {
    success: true,
    exists: count > 0,
    count
  }
})

ipcMain.handle('process:images', async (event, dirPath) => {
  console.log('\n📂 Processing directory:', dirPath)
  
  if (!await checkEndpointStatus()) {
    return { success: false, error: 'Endpoint is not ready.' }
  }
  
  await vectordb.initialize()
  
  const files = await fs.readdir(dirPath)
  const imageFiles = files.filter(file => 
    /\.(jpg|jpeg|png|gif|tif|tiff)$/i.test(file)
  )
  
  if (imageFiles.length === 0) {
    return { 
      success: false, 
      error: 'No supported image files found in the directory'
    }
  }
  
  const imagePaths = imageFiles.map(file => path.join(dirPath, file))
  const totalImages = imagePaths.length
  let processedCount = 0
  let failedCount = 0
  
  event.sender.send('process:progress', 10)
  
  const batchResults = await processBatch(imagePaths, (processed) => {
    const progress = 10 + ((processed / totalImages) * 90)
    event.sender.send('process:progress', progress)
  })
  
  for (const result of batchResults) {
    if (result.success) {
      const textEmbedding = await computeEmbedding(result.description)
      
      await vectordb.storeImage(
        result.imagePath,
        result.base64Image,
        result.description,
        Array.from(textEmbedding.data),
        result.image_embedding
      )
      
      processedCount++
    } else {
      failedCount++
    }
  }
  
  return {
    success: true,
    count: processedCount,
    failed: failedCount,
    total: imageFiles.length
  }
})

ipcMain.handle('search:images', async (event, query, checkRelevance, selectedDirectories, limit = 20, offset = 0) => {
    if (!query || !query.trim()) {
        return { results: [], total: 0, hasMore: false }
    }
    
    if (!await checkEndpointStatus()) {
        return { results: [], total: 0, hasMore: false }
    }
    
    event.sender.send('search:progress', 10)
    const queryEmbedding = await computeEmbedding(query, 'query')
    
    const totalCount = await vectordb.getTotalCount(Array.from(queryEmbedding.data), selectedDirectories, query)
    
    event.sender.send('search:progress', 50)
    
    let results = await vectordb.search(Array.from(queryEmbedding.data), limit, selectedDirectories, query, offset)
    
    console.log(`\n💬 Search query: ${query}`)
    console.log(`📜 Search results: ${results.length}`)
    
    if (checkRelevance && results.length > 0) {
        event.sender.send('search:progress', 70)
        results = await batchRelevance(results, query, (processed, total) => {
            const progress = 70 + ((processed / total) * 30)
            event.sender.send('search:progress', progress)
        })
        console.log(`\n📜 Search results with relevance check: ${results.length}`)
    } else {
        event.sender.send('search:progress', 100)
    }
    
    const hasMore = offset + results.length < totalCount
    
    return { 
        results,
        total: totalCount,
        hasMore
    }
})

ipcMain.handle('enhance:prompt', async (event, prompt) => {
  const openaiApiKey = store.get('openai.apiKey');
  
  if (!openaiApiKey) {
      return { 
          success: false, 
          error: 'OpenAI API key not set'
      };
  }
  
  try {
      const { enhancePrompt } = require('./services/prompt');
      return await enhancePrompt(prompt, openaiApiKey);
  } catch (error) {
      return {
          success: false,
          error: error.message
      };
  }
});

ipcMain.handle('endpoint:check', async () => {
  try {
    const workers = await checkAvailableWorkers()
    return workers > 0
  } catch {
    return false
  }
})

ipcMain.handle('get:directories', async () => {
    await vectordb.initialize()
    return await vectordb.getDirectories()
})

ipcMain.handle('drop:directory', async (event, directory) => {
    console.log(`\n🗑️ Dropping directory: ${directory}`)
    const removedCount = await vectordb.dropDirectory(directory)
    console.log(`✅ Dropped directory: ${directory}`)
    return {
        success: true,
        count: removedCount,
        message: `Successfully removed ${directory}`
    }
})