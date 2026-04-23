document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        initialView: document.getElementById('initial-view'),
        apiSetup: document.getElementById('api-setup'),
        apiKeyInput: document.getElementById('api-key'),
        endpointInput: document.getElementById('endpoint'),
        saveSettingsButton: document.getElementById('save-settings'),
        selectDirButton: document.getElementById('select-directory'),
        processingOverlay: document.querySelector('.loading-overlay.processing'),
        searchView: document.getElementById('search-view'),
        searchingOverlay: document.querySelector('.loading-overlay.searching'),
        droppingOverlay: document.querySelector('.loading-overlay.dropping'),
        searchInput: document.querySelector('.search-input'),
        resultsList: document.querySelector('.results-list'),
        addDirButton: document.getElementById('add-directory'),
        dirFilter: document.getElementById('filter-directory'),
        directoryDropdown: document.querySelector('.directory-dropdown'),
        limitFilter: document.getElementById('limit-filter'),
        limitDropdown: document.querySelector('.limit-dropdown'),
        relevanceCheck: document.getElementById('relevance-check'),
        openaiApiKeyInput: document.getElementById('openai-api-key'),
        enhanceButton: document.getElementById('enhance-button'),
        copyText: document.querySelector('.copy-text'),
    }

    const progressBars = {
        processing: elements.processingOverlay.querySelector('.progress-bar'),
        searching: elements.searchingOverlay.querySelector('.progress-bar'),
        dropping: elements.droppingOverlay.querySelector('.progress-bar')
    }

    let selectedDirectories = [];
    let selectedLimit = 20;
    let currentQuery = '';
    let currentOffset = 0;
    let isLoading = false;
    let hasMoreResults = true;

    elements.selectDirButton.style.display = 'none';
    elements.apiSetup.style.display = 'block';

    window.electronAPI.onProcessProgress(progress => {
        progressBars.processing.style.width = `${progress}%`
    })

    window.electronAPI.onSearchProgress(progress => {
        progressBars.searching.style.width = `${progress}%`
    })

    async function loadSavedCredentials() {
        const credentials = await window.electronAPI.getStoredCredentials();
        if (credentials) {
            if (credentials.apiKey) {
                elements.apiKeyInput.value = credentials.apiKey;
            }
            if (credentials.endpoint) {
                elements.endpointInput.value = credentials.endpoint;
            }
            if (credentials.openaiApiKey) {
                elements.openaiApiKeyInput.value = credentials.openaiApiKey;
            }
            await verifyCredentials();
        }
    }

    async function verifyCredentials() {
        const apiKey = elements.apiKeyInput.value.trim();
        const endpoint = elements.endpointInput.value.trim();
        const openaiApiKey = elements.openaiApiKeyInput ? elements.openaiApiKeyInput.value.trim() : '';
        
        if (!apiKey || !endpoint) {
            return false;
        }
        
        const result = await window.electronAPI.setCredentials(apiKey, endpoint, openaiApiKey);
        if (!result.success) {
            return false;
        }
        
        const { success, exists, count } = await window.electronAPI.checkDatabase();
        if (success && exists && count > 0) {
            elements.initialView.style.display = 'none';
            elements.searchView.style.display = 'block';
            await updateDirectoryList();
            elements.searchInput.focus();
        } else {
            elements.apiSetup.style.display = 'none';
            elements.selectDirButton.style.display = 'block';
        }
        return true;
    }

    elements.saveSettingsButton.addEventListener('click', async () => {
        const apiKey = elements.apiKeyInput.value.trim();
        const endpoint = elements.endpointInput.value.trim();
        const openaiApiKey = elements.openaiApiKeyInput ? elements.openaiApiKeyInput.value.trim() : '';
        
        if (!apiKey || !endpoint) {
            alert('Please configure your RunPod API access credentials.');
            return;
        }
        
        elements.saveSettingsButton.disabled = true;
        elements.saveSettingsButton.textContent = 'Connecting...';
        
        const result = await window.electronAPI.setCredentials(apiKey, endpoint, openaiApiKey);
        
        if (result.success) {
            const { success, exists, count } = await window.electronAPI.checkDatabase();
            if (success && exists && count > 0) {
                setTimeout(() => {
                    elements.initialView.style.display = 'none';
                    elements.searchView.style.display = 'block';
                    updateDirectoryList();
                    elements.searchInput.focus();
                }, 1000);
            } else {
                setTimeout(() => {
                    elements.apiSetup.style.display = 'none';
                    elements.selectDirButton.style.display = 'block';
                }, 1000);
            }
        } else {
            alert(`Connection error: ${result.error || 'Connection failed'}`);
        }
        
        elements.saveSettingsButton.disabled = false;
        elements.saveSettingsButton.textContent = 'Connect';
    });

    await loadSavedCredentials();

    async function handleDirectorySelect(switchView = false) {
        const dirPath = await window.electronAPI.selectDirectory()
        if (!dirPath) return

        progressBars.processing.style.width = '0%'
        elements.processingOverlay.style.display = 'flex'
        
        const result = await window.electronAPI.processImages(dirPath)
        elements.processingOverlay.style.display = 'none'
        
        if (result.success) {
            if (switchView) {
                elements.initialView.style.display = 'none'
                elements.searchView.style.display = 'block'
            }
            await updateDirectoryList()
            elements.searchInput.focus()
        } else {
            alert(result.error || 'Error processing images')
        }
    }

    async function performSearch(query, append = false) {
        const dropMatch = query.match(/^DROP\s+(\/.+)$/i);
        if (dropMatch) {
            const directory = dropMatch[1];
            elements.droppingOverlay.style.display = 'flex';
            progressBars.dropping.style.width = '50%';
            
            const result = await window.electronAPI.dropDirectory(directory);
            progressBars.dropping.style.width = '100%';
            
            if (result.success) {
                elements.searchInput.value = '';
                elements.resultsList.innerHTML = '';
                await updateDirectoryList();
                selectedDirectories = selectedDirectories.filter(dir => dir !== directory);
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
            elements.droppingOverlay.style.display = 'none';
            progressBars.dropping.style.width = '0%';
            return;
        }

        if (!query.trim()) {
            elements.resultsList.innerHTML = '';
            return;
        }

        if (!append) {
            currentQuery = query;
            currentOffset = 0;
            hasMoreResults = true;
            elements.resultsList.innerHTML = '';
        }

        if (!hasMoreResults || isLoading) return;
        
        isLoading = true;
        elements.searchingOverlay.style.display = 'flex'
        progressBars.searching.style.width = '0%'
        
        const useRelevanceCheck = elements.relevanceCheck.classList.contains('active');
        
        const response = await window.electronAPI.searchImages(
            query, 
            useRelevanceCheck,
            selectedDirectories.length > 0 ? selectedDirectories : null,
            selectedLimit,
            currentOffset
        );
        
        if (useRelevanceCheck) {
            elements.relevanceCheck.classList.remove('active');
        }
        
        const results = response.results;
        hasMoreResults = response.hasMore;
        
        progressBars.searching.style.width = '100%'
        
        if (results.length === 0) {
            hasMoreResults = false;
        } else {
            const resultsHtml = results.map(result => `
                <li class="result-item">
                    <img src="data:image/jpeg;base64,${result.image}" 
                         class="result-image">
                    <div class="result-details">
                        <p title="Similarity score. Visear computes similarity score by combining vector embeddings of text descriptions, visual similarity between images, and text matching using Levenshtein distance. Higher scores indicate better matches across all three factors." >${(result.similarity * 100).toFixed(1)}%</p>
                        <img src="../assets/replace.svg" alt="Find similar images" title="Search for similar images" class="similar-icon" data-description="${result.description}">
                        <img src="../assets/info.svg" alt="Image path info icon" title="${result.description}" class="info-icon" data-description="${result.description}">
                        <img src="../assets/copy.svg" alt="Copy image path icon" title="${result.path}" class="copy-icon" data-path="${result.path}">
                        <span class="copy-feedback"></span>
                    </div>
                </li>
            `).join('');
            
            if (append) {
                elements.resultsList.innerHTML += resultsHtml;
            } else {
                elements.resultsList.innerHTML = resultsHtml;
            }
            
            currentOffset += results.length;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        elements.searchingOverlay.style.display = 'none';
        isLoading = false;
    }

    elements.enhanceButton.addEventListener('click', async () => {
        const currentPrompt = elements.searchInput.value.trim();
        if (!currentPrompt) return;
                
        elements.enhanceButton.disabled = true;
        elements.enhanceButton.classList.add('enhancing');
        
        const result = await window.electronAPI.enhancePrompt(currentPrompt);
        
        elements.enhanceButton.disabled = false;
        elements.enhanceButton.classList.remove('enhancing');
        
        if (result.success) {
            elements.searchInput.value = result.enhancedPrompt;
            elements.searchInput.focus();
        } else {
            alert(`Failed to enhance prompt: ${result.error}`);
        }
    });

    async function updateDirectoryList() {
        const directories = await window.electronAPI.getDirectories();
        const dropdownContent = [];
        
        selectedDirectories = [...directories];
        
        directories.forEach(dir => {
            dropdownContent.push(`
                <div class="directory-item">
                    <input type="checkbox" id="dir-${dir.replace(/[^a-zA-Z0-9]/g, '-')}" data-dir="${dir}" checked>
                    <label for="dir-${dir.replace(/[^a-zA-Z0-9]/g, '-')}">${dir}</label>
                </div>
            `);
        });
        
        const directoryList = elements.directoryDropdown.querySelector('.directory-list');
        directoryList.innerHTML = dropdownContent.join('');

        elements.directoryDropdown.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const dir = checkbox.dataset.dir;
                if (checkbox.checked) {
                    if (!selectedDirectories.includes(dir)) {
                        selectedDirectories.push(dir);
                    }
                } else {
                    selectedDirectories = selectedDirectories.filter(d => d !== dir);
                }
            });
        });
    }

    elements.selectDirButton.addEventListener('click', () => handleDirectorySelect(true))
    elements.addDirButton.addEventListener('click', () => handleDirectorySelect(false))

    elements.searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch(e.target.value, false);
        }
    })

    document.addEventListener('click', () => {
        elements.dirFilter.parentElement.classList.remove('active');
        elements.limitFilter.parentElement.classList.remove('active');
    });

    elements.dirFilter.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.dirFilter.parentElement.classList.toggle('active');
    });

    elements.directoryDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    elements.limitFilter.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.limitFilter.parentElement.classList.toggle('active');
    });

    elements.limitDropdown.addEventListener('click', (e) => {
        if (e.target.classList.contains('directory-item')) {
            const limit = parseInt(e.target.dataset.limit);
            selectedLimit = limit;
            
            elements.limitDropdown.querySelectorAll('.directory-item').forEach(item => {
                item.classList.toggle('selected', parseInt(item.dataset.limit) === limit);
            });
            
            elements.limitFilter.parentElement.classList.remove('active');
        }
    });

    elements.relevanceCheck.addEventListener('click', () => {
        elements.relevanceCheck.classList.toggle('active');
    });

    elements.resultsList.addEventListener('click', async (e) => {
        if (e.target.classList.contains('copy-icon')) {
            const path = e.target.dataset.path;
            await navigator.clipboard.writeText(path);
            const feedback = e.target.parentElement.querySelector('.copy-feedback');
            feedback.textContent = 'Location copied';
            feedback.style.opacity = '1';
            setTimeout(() => {
                feedback.style.opacity = '0';
            }, 3000);
        } else if (e.target.classList.contains('info-icon')) {
            const description = e.target.dataset.description;
            await navigator.clipboard.writeText(description);
            const feedback = e.target.parentElement.querySelector('.copy-feedback');
            feedback.textContent = 'Description copied';
            feedback.style.opacity = '1';
            setTimeout(() => {
                feedback.style.opacity = '0';
            }, 3000);
        } else if (e.target.classList.contains('similar-icon')) {
            const description = e.target.dataset.description;
            elements.searchInput.value = description;
            performSearch(description, false);
        }
    });

    elements.copyText.addEventListener('click', async () => {
        const email = elements.copyText.textContent;
        await navigator.clipboard.writeText(email);
    });

    const resultsContainer = document.querySelector('.results-container');
    resultsContainer.addEventListener('scroll', () => {
        if (isLoading || !hasMoreResults) return;
        
        const scrollPosition = resultsContainer.scrollTop + resultsContainer.clientHeight;
        const scrollHeight = resultsContainer.scrollHeight;
        const threshold = 20;
        
        if (scrollHeight - scrollPosition < threshold && currentQuery) {
            performSearch(currentQuery, true);
        }
    });
    
}) 