// Viewer JavaScript file - Enhanced with pagination and better UI/UX
// This file is included in the viewer.html template

let websocket;
let requests = [];
let currentPage = 0;
const pageSize = 10; // Number of requests per page
let username = '';
let requestModal;
let toast;
let isLoading = false;
let hasMoreRequests = true;

// Safe syntax highlighting function
function safeHighlightCode(element) {
    if (typeof hljs !== 'undefined') {
        try {
            hljs.highlightElement(element);
        } catch (error) {
            console.warn('Error highlighting code block:', error);
        }
    } else {
        console.warn('Highlight.js not loaded');
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing viewer script');
    
    // Get username from URL
    username = window.location.pathname.split('@')[1];
    console.log('Extracted username:', username);
    
    // Validate username
    if (!username) {
        console.error('Invalid username');
        showError('Invalid username. Please go back to the dashboard and create a webhook.');
        return;
    }
    
    // Initialize Bootstrap components
    try {
        requestModal = new bootstrap.Modal(document.getElementById('requestModal'));
        toast = new bootstrap.Toast(document.getElementById('newRequestToast'));
    } catch (error) {
        console.error('Error initializing Bootstrap components:', error);
    }
    
    // Setup code highlighting
    setupCodeHighlighting();
    
    // Connect to WebSocket for real-time updates
    connectWebSocket();
    
    // Load initial requests
    loadRequests();
    
    // Setup event handlers
    setupEventHandlers();
});

// Setup code highlighting
function setupCodeHighlighting() {
    function applyHighlighting() {
        if (typeof hljs !== 'undefined') {
            try {
                document.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            } catch (error) {
                console.warn('Error highlighting initial code blocks:', error);
            }
        } else {
            // If hljs is not loaded, retry after a short delay
            setTimeout(applyHighlighting, 1000);
        }
    }
    applyHighlighting();
}

// Connect to WebSocket for real-time updates
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/viewer/@${username}`;
    console.log("Connecting to WebSocket:", wsUrl);
    
    websocket = new WebSocket(wsUrl);
    
    websocket.onopen = function(event) {
        console.log('WebSocket connection established');
        updateConnectionStatus('connected');
    };
    
    websocket.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            console.log("WebSocket message received:", data);
            
            // Handle different types of WebSocket events
            switch(data.event) {
                case 'connected':
                    // Initial connection event
                    console.log('WebSocket connected for username:', data.username);
                    break;
                
                case 'new_request':
                    // New request received
                    const toastTime = document.getElementById('toastTime');
                    const toastContent = document.getElementById('toastContent');
                    
                    if (toastTime) toastTime.textContent = new Date().toLocaleTimeString();
                    if (toastContent) toastContent.textContent = `New ${data.method} request received`;
                    
                    try {
                        toast.show();
                    } catch (e) {
                        console.error('Error showing toast:', e);
                    }
                    
                    // Refresh requests to show the latest request
                    refreshRequests();
                    break;
                
                case 'ping':
                    // Keep-alive ping from server
                    console.log('Received ping from server');
                    break;
                
                default:
                    console.log('Unhandled WebSocket event:', data.event);
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    };
    
    websocket.onclose = function(event) {
        console.log("WebSocket connection closed");
        updateConnectionStatus('disconnected');
        
        // Try to reconnect after a random interval to prevent thundering herd
        const reconnectTimeout = 5000 + Math.random() * 5000;
        setTimeout(connectWebSocket, reconnectTimeout);
    };
    
    websocket.onerror = function(error) {
        console.error('WebSocket error:', error);
        updateConnectionStatus('error');
    };
}

// Update connection status indicator
function updateConnectionStatus(status) {
    const statusIndicator = document.getElementById('connectionStatus');
    const statusText = document.getElementById('connectionStatusText');
    
    if (!statusIndicator || !statusText) return;
    
    switch(status) {
        case 'connected':
            statusIndicator.className = 'bg-success';
            statusText.textContent = 'Connected';
            break;
            
        case 'disconnected':
            statusIndicator.className = 'bg-warning';
            statusText.textContent = 'Disconnected';
            break;
            
        case 'error':
            statusIndicator.className = 'bg-danger';
            statusText.textContent = 'Connection Error';
            break;
            
        default:
            statusIndicator.className = 'bg-secondary';
            statusText.textContent = 'Connecting...';
    }
}

// Load requests with pagination
function loadRequests(loadMore = false) {
    if (isLoading) return;
    
    isLoading = true;
    
    // Show loading spinner
    const loadingSpinner = document.getElementById('loadingSpinner');
    if (loadingSpinner) loadingSpinner.style.display = 'flex';
    
    // Calculate skip for pagination
    const skip = loadMore ? requests.length : 0;
    
    // If not loading more, reset current data
    if (!loadMore) {
        requests = [];
        currentPage = 0;
    }
    
    console.log(`Loading requests for ${username}, skip: ${skip}, limit: ${pageSize}`);
    
    // Fetch requests from API
    fetch(`/api/requests/@${username}?limit=${pageSize}&skip=${skip}`)
        .then(response => {
            if (!response.ok) {
                return response.json().then(errData => {
                    throw new Error(`API Error: ${JSON.stringify(errData)}`);
                }).catch(() => {
                    throw new Error(`HTTP error! status: ${response.status}`);
                });
            }
            return response.json();
        })
        .then(data => {
            console.log(`Received ${data.length} requests`);
            
            // Hide loading spinner
            if (loadingSpinner) loadingSpinner.style.display = 'none';
            
            // Ensure data is an array
            if (!Array.isArray(data)) {
                console.error("Received data is not an array:", data);
                data = [];
            }
            
            // Update hasMoreRequests flag
            hasMoreRequests = data.length === pageSize;
            
            // Show/hide load more button
            const loadMoreContainer = document.getElementById('loadMoreContainer');
            if (loadMoreContainer) {
                loadMoreContainer.style.display = hasMoreRequests ? 'block' : 'none';
            }
            
            if (loadMore) {
                // Append new requests to existing array
                requests = requests.concat(data);
                renderRequests(data, true);
            } else {
                // Replace requests with new data
                requests = data;
                renderRequests(data, false);
            }
            
            // Update request count
            const requestCountElem = document.getElementById('requestCount');
            if (requestCountElem) {
                // Get total count from server
                fetch(`/api/requests/@${username}/count`)
                    .then(response => response.json())
                    .then(countData => {
                        requestCountElem.textContent = countData.count.toLocaleString();
                    })
                    .catch(error => {
                        console.error('Error fetching request count:', error);
                        requestCountElem.textContent = requests.length;
                    });
            }
            
            isLoading = false;
        })
        .catch(error => {
            console.error('Error loading requests:', error);
            
            // Hide loading spinner
            if (loadingSpinner) loadingSpinner.style.display = 'none';
            
            // Show error
            showError(`Failed to load requests: ${error.message}`);
            
            isLoading = false;
        });
}

// Refresh requests by fetching the latest
function refreshRequests() {
    // Reset page index
    currentPage = 0;
    
    // Load first page of requests
    loadRequests(false);
}

// Render requests to the container
function renderRequests(requestsToRender, append = false) {
    const container = document.getElementById('requestsContainer');
    
    if (!container) return;
    
    if (!append && (!requestsToRender || requestsToRender.length === 0)) {
        showEmptyState(container);
        return;
    }
    
    // If this is the first render and not appending, clear the container
    if (!append) {
        container.innerHTML = '';
    }
    
    requestsToRender.forEach(req => {
        // Ensure all required fields exist
        const method = req.method || 'UNKNOWN';
        const path = req.path || '/';
        const requestTime = req.request_time ? new Date(req.request_time).toLocaleString() : 'Unknown';
        const responseTime = req.response_time || 0;
        
        // Create request card element
        const cardElement = document.createElement('div');
        cardElement.className = 'card shadow-sm mb-3 request-card';
        cardElement.setAttribute('data-id', req.id || '');
        
        cardElement.innerHTML = `
            <div class="card-header d-flex justify-content-between align-items-center">
                <div>
                    <span class="badge badge-${method}">${method}</span>
                    <span class="ms-2 path-display">${formatPath(path)}</span>
                </div>
                <div>
                    <span class="text-muted me-2">${requestTime}</span>
                    <span class="badge bg-secondary">${responseTime} ms</span>
                </div>
            </div>
            <div class="card-body">
                <div class="row">
                    <div class="col-md-6 mb-3 mb-md-0">
                        <h6 class="mb-2">Request</h6>
                        <pre class="code-block"><code class="language-json">${formatCodeBlock(req.body)}</code></pre>
                    </div>
                    <div class="col-md-6">
                        <h6 class="mb-2">Response</h6>
                        <pre class="code-block"><code class="language-json">${formatCodeBlock(req.response)}</code></pre>
                    </div>
                </div>
                <div class="mt-3 d-flex justify-content-between">
                    <button class="btn btn-sm btn-outline-primary view-details-btn">
                        <i class="fas fa-search me-1"></i>View Details
                    </button>
                    <button class="btn btn-sm btn-outline-danger delete-request-btn" data-id="${req.id || ''}">
                        <i class="fas fa-trash me-1"></i>Delete
                    </button>
                </div>
            </div>
        `;
        
        container.appendChild(cardElement);
        
        // Apply syntax highlighting
        const requestCode = cardElement.querySelector('.card-body code:nth-of-type(1)');
        const responseCode = cardElement.querySelector('.card-body code:nth-of-type(2)');
        
        if (requestCode) safeHighlightCode(requestCode);
        if (responseCode) safeHighlightCode(responseCode);
        
        // Add delete button event listener
        const deleteBtn = cardElement.querySelector('.delete-request-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function(event) {
                event.stopPropagation();
                const requestId = this.getAttribute('data-id');
                deleteRequest(requestId);
            });
        }
    });
}

// Delete a single request
function deleteRequest(requestId) {
    Swal.fire({
        title: 'Delete Request?',
        text: 'Are you sure you want to delete this request?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, delete it',
        cancelButtonText: 'Cancel'
    }).then((result) => {
        if (result.isConfirmed) {
            fetch(`/api/requests/@${username}/${requestId}`, {
                method: 'DELETE'
            })
            .then(response => response.json())
            .then(data => {
                // Remove from UI
                const requestCard = document.querySelector(`.request-card[data-id="${requestId}"]`);
                if (requestCard) {
                    requestCard.remove();
                }
                
                // Remove from requests array
                requests = requests.filter(req => req.id !== requestId);
                
                // Update count
                const requestCountElem = document.getElementById('requestCount');
                if (requestCountElem) {
                    const currentCount = parseInt(requestCountElem.textContent.replace(/,/g, ''));
                    requestCountElem.textContent = (currentCount - 1).toLocaleString();
                }
                
                // Show toast
                showToast('Request deleted successfully');
                
                // Check if we need to show empty state
                if (requests.length === 0) {
                    const container = document.getElementById('requestsContainer');
                    if (container) {
                        showEmptyState(container);
                    }
                }
            })
            .catch(error => {
                console.error('Error deleting request:', error);
                showError('Failed to delete request');
            });
        }
    });
}

// Show empty state when there are no requests
function showEmptyState(container) {
    container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-inbox mb-3"></i>
            <h4>No Requests Yet</h4>
            <p class="mb-4">Send a request to your webhook URL to see it here</p>
            <div class="input-group mb-3 mx-auto" style="max-width: 500px;">
                <input type="text" class="form-control" value="https://${window.location.host}/api/@${username}" readonly>
                <button class="btn btn-outline-secondary" type="button" id="emptyStateCopyBtn">
                    <i class="fas fa-copy"></i> Copy
                </button>
            </div>
            <div class="mt-3">
                <p>Try using cURL:</p>
                <pre><code class="language-bash">curl -X POST https://${window.location.host}/api/@${username} -H "Content-Type: application/json" -d '{"message": "Hello, World!"}'</code></pre>
            </div>
        </div>
    `;
    
    // Highlight the code block
    try {
        hljs.highlightElement(container.querySelector('pre code'));
    } catch (error) {
        console.warn('Error highlighting code block:', error);
    }
    
    // Add copy button event listener
    const copyBtn = container.querySelector('#emptyStateCopyBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', function() {
            const urlInput = copyBtn.previousElementSibling;
            urlInput.select();
            navigator.clipboard.writeText(urlInput.value).then(() => {
                showToast('URL copied to clipboard!');
            });
        });
    }
}

// Format path for display
function formatPath(path) {
    // Truncate if too long
    if (path.length > 40) {
        return path.substring(0, 37) + '...';
    }
    return path;
}

// Format code blocks for display
function formatCodeBlock(content) {
    if (!content) return 'null';
    
    if (typeof content === 'object') {
        try {
            return JSON.stringify(content, null, 2);
        } catch (e) {
            return String(content);
        }
    }
    
    if (typeof content === 'string' && content.trim().startsWith('{')) {
        try {
            // Try to parse as JSON
            return JSON.stringify(JSON.parse(content), null, 2);
        } catch (e) {
            // Return as is
            return content;
        }
    }
    
    return String(content || 'null');
}

// Show error message
function showError(message, details = '') {
    Swal.fire({
        title: 'Error',
        html: `${message}${details ? `<br><small>${details}</small>` : ''}`,
        icon: 'error',
        confirmButtonText: 'OK'
    });
}

// Show success toast
function showToast(message) {
    Swal.fire({
        title: message,
        toast: true,
        position: 'top-end',
        icon: 'success',
        showConfirmButton: false,
        timer: 3000
    });
}

// Setup event handlers
function setupEventHandlers() {
    // Copy webhook URL to clipboard
    const copyUrlBtn = document.getElementById('copyUrlBtn');
    if (copyUrlBtn) {
        copyUrlBtn.addEventListener('click', function() {
            const webhookUrl = document.getElementById('webhookUrl');
            if (webhookUrl) {
                navigator.clipboard.writeText(webhookUrl.value).then(() => {
                    showToast('URL copied to clipboard!');
                });
            }
        });
    }
    
    // View request details
    document.addEventListener('click', function(event) {
        if (event.target.classList.contains('view-details-btn') || 
            event.target.closest('.view-details-btn')) {
            const requestCard = event.target.closest('.request-card');
            if (requestCard) {
                const requestId = requestCard.getAttribute('data-id');
                showRequestDetails(requestId);
            }
        }
    });
    
    // Load more requests
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', function() {
            loadRequests(true);
        });
    }
    
    // Export dropdown options
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', function() {
            window.location.href = `/api/requests/@${username}/export?format=csv`;
        });
    }
    
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', function() {
            window.location.href = `/api/requests/@${username}/export?format=json`;
        });
    }
    
    // Clear all requests
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            Swal.fire({
                title: 'Clear All Requests?',
                text: 'This action cannot be undone!',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Yes, clear all',
                cancelButtonText: 'Cancel'
            }).then((result) => {
                if (result.isConfirmed) {
                    fetch(`/api/requests/@${username}`, {
                        method: 'DELETE'
                    })
                    .then(response => response.json())
                    .then(data => {
                        showToast(`Deleted ${data.deleted_count} requests.`);
                        
                        // Reload requests
                        refreshRequests();
                    })
                    .catch(error => {
                        console.error('Error clearing requests:', error);
                        showError('Failed to clear requests.');
                    });
                }
            });
        });
    }
    
    // Refresh requests
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            refreshRequests();
        });
    }
    
    // Update webhook configuration
    const updateConfigBtn = document.getElementById('updateConfigBtn');
    if (updateConfigBtn) {
        updateConfigBtn.addEventListener('click', function() {
            updateWebhookConfig();
        });
    }
    
    // Format JSON in configuration form
    const updateDefaultResponse = document.getElementById('updateDefaultResponse');
    if (updateDefaultResponse) {
        updateDefaultResponse.addEventListener('blur', function() {
            try {
                const json = JSON.parse(this.value);
                this.value = JSON.stringify(json, null, 2);
            } catch (e) {
                // Not valid JSON, leave as is
            }
        });
    }
}

// Update webhook configuration
function updateWebhookConfig() {
    const defaultResponse = document.getElementById('updateDefaultResponse');
    const minTime = document.getElementById('updateResponseTimeMin');
    const maxTime = document.getElementById('updateResponseTimeMax');
    
    if (!defaultResponse || !minTime || !maxTime) return;
    
    let responseData;
    
    try {
        responseData = JSON.parse(defaultResponse.value);
    } catch (e) {
        showError('Invalid JSON for default response');
        return;
    }
    
    const minTimeValue = parseInt(minTime.value);
    const maxTimeValue = parseInt(maxTime.value);
    
    if (isNaN(minTimeValue) || isNaN(maxTimeValue) || minTimeValue < 0 || maxTimeValue < 0 || minTimeValue > maxTimeValue) {
        showError('Invalid response times', 'Min time must be less than or equal to max time, and both must be non-negative.');
        return;
    }
    
    const updateData = {
        default_response: responseData,
        response_time_min: minTimeValue,
        response_time_max: maxTimeValue
    };
    
    fetch(`/api/users/${username}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(errData => {
                throw new Error(`API Error: ${JSON.stringify(errData)}`);
            }).catch(() => {
                throw new Error(`HTTP error! status: ${response.status}`);
            });
        }
        return response.json();
    })
    .then(data => {
        showToast('Webhook configuration updated successfully');
    })
    .catch(error => {
        console.error('Error updating configuration:', error);
        showError('Failed to update webhook configuration', error.message);
    });
}

// Show request details in modal
function showRequestDetails(requestId) {
    const request = requests.find(r => r.id === requestId);
    
    if (!request) {
        console.error('Request not found for ID:', requestId);
        showError('Request details not found');
        return;
    }
    
    const modalContent = document.getElementById('modalContent');
    const modalTitle = document.getElementById('modalTitle');
    
    if (!modalContent || !modalTitle) {
        console.error('Modal elements not found');
        return;
    }
    
    // Convert request time to localized string
    const requestTime = request.request_time ? 
        new Date(request.request_time).toLocaleString() : 
        'Unknown Time';
    
    // Prepare headers display
    let headersHtml = '<pre class="bg-light p-2"><code class="language-json">';
    
    if (request.headers && Object.keys(request.headers).length > 0) {
        headersHtml += JSON.stringify(request.headers, null, 2);
    } else {
        headersHtml += 'No headers found';
    }
    
    headersHtml += '</code></pre>';
    
    // Prepare query params display
    let queryParamsHtml = '<pre class="bg-light p-2"><code class="language-json">';
    
    if (request.query_params && Object.keys(request.query_params).length > 0) {
        queryParamsHtml += JSON.stringify(request.query_params, null, 2);
    } else {
        queryParamsHtml += 'No query parameters found';
    }
    
    queryParamsHtml += '</code></pre>';
    
    // Prepare modal HTML content
    modalContent.innerHTML = `
        <ul class="nav nav-tabs" id="detailsTabs" role="tablist">
            <li class="nav-item" role="presentation">
                <button class="nav-link active" id="overview-tab" data-bs-toggle="tab" 
                        data-bs-target="#overview" type="button" role="tab">Overview</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="headers-tab" data-bs-toggle="tab" 
                        data-bs-target="#headers" type="button" role="tab">Headers</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="body-tab" data-bs-toggle="tab" 
                        data-bs-target="#body" type="button" role="tab">Request Body</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="response-tab" data-bs-toggle="tab" 
                        data-bs-target="#response" type="button" role="tab">Response</button>
            </li>
        </ul>
        
        <div class="tab-content p-3" id="detailsTabsContent">
            <div class="tab-pane fade show active" id="overview" role="tabpanel">
                <div class="row">
                    <div class="col-md-6">
                        <div class="mb-3">
                            <span class="badge badge-${request.method || 'UNKNOWN'}">${request.method || 'UNKNOWN'}</span>
                            <span class="ms-2 fw-bold">${request.path || '/'}</span>
                        </div>
                        <p><strong>Request ID:</strong> ${request.id || 'N/A'}</p>
                        <p><strong>Time:</strong> ${requestTime}</p>
                        <p><strong>Response Time:</strong> ${request.response_time || 0} ms</p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>Query Parameters:</strong></p>
                        ${queryParamsHtml}
                    </div>
                </div>
            </div>
            
            <div class="tab-pane fade" id="headers" role="tabpanel">
                <h6>Request Headers</h6>
                ${headersHtml}
            </div>
            
            <div class="tab-pane fade" id="body" role="tabpanel">
                <h6>Request Body</h6>
                <pre class="bg-light p-2"><code class="language-json">${formatCodeBlock(request.body)}</code></pre>
            </div>
            
            <div class="tab-pane fade" id="response" role="tabpanel">
                <h6>Response Body</h6>
                <pre class="bg-light p-2"><code class="language-json">${formatCodeBlock(request.response)}</code></pre>
            </div>
        </div>
        
        <div class="mt-3 d-flex justify-content-between">
            <button class="btn btn-outline-primary" id="copyDetailsBtn">
                <i class="fas fa-copy me-1"></i>Copy as cURL
            </button>
            <button class="btn btn-outline-danger" id="modalDeleteBtn" data-id="${request.id}">
                <i class="fas fa-trash me-1"></i>Delete Request
            </button>
        </div>
    `;
    
    // Set modal title
    modalTitle.textContent = `Request Details`;
    
    // Highlight code blocks
    try {
        modalContent.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    } catch (error) {
        console.warn('Error highlighting modal code blocks:', error);
    }
    
    // Add copy as cURL button event listener
    const copyDetailsBtn = modalContent.querySelector('#copyDetailsBtn');
    if (copyDetailsBtn) {
        copyDetailsBtn.addEventListener('click', function() {
            const curlCommand = generateCurlCommand(request);
            navigator.clipboard.writeText(curlCommand).then(() => {
                showToast('cURL command copied to clipboard!');
            });
        });
    }
    
    // Add delete button event listener
    const modalDeleteBtn = modalContent.querySelector('#modalDeleteBtn');
    if (modalDeleteBtn) {
        modalDeleteBtn.addEventListener('click', function() {
            const requestId = this.getAttribute('data-id');
            if (requestModal) {
                requestModal.hide();
            }
            deleteRequest(requestId);
        });
    }
    
    // Show the modal
    try {
        if (requestModal) {
            requestModal.show();
        } else {
            console.error('Request modal not initialized');
        }
    } catch (error) {
        console.error('Error showing modal:', error);
        showError('Could not open request details');
    }
}

// Generate cURL command for a request
function generateCurlCommand(request) {
    let curlCmd = `curl -X ${request.method} "${window.location.protocol}//${window.location.host}${request.path}"`;
    
    // Add headers
    if (request.headers && Object.keys(request.headers).length > 0) {
        for (const [key, value] of Object.entries(request.headers)) {
            // Skip host header
            if (key.toLowerCase() === 'host') continue;
            
            curlCmd += `\n  -H "${key}: ${value.replace(/"/g, '\\"')}"`;
        }
    }
    
    // Add body for POST, PUT, PATCH
    if (['POST', 'PUT', 'PATCH'].includes(request.method) && request.body) {
        let body = request.body;
        
        if (typeof body === 'object') {
            body = JSON.stringify(body);
        }
        
        curlCmd += `\n  -d '${body.replace(/'/g, "\\'")}'`;
    }
    
    return curlCmd;
}