// Viewer JavaScript file
// This file is included in the viewer.html template

// Globals
let websocket;
let requests = [];
let currentPage = 0;
const pageSize = 20; // Number of requests per page
let username = '';
let requestModal;
let toast;

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
    try {
        document.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    } catch (error) {
        console.warn('Error highlighting code blocks:', error);
    }
    
    // Connect to WebSocket for real-time updates
    connectWebSocket();
    
    // Load initial requests
    loadRequests();
    
    // Setup event handlers
    setupEventHandlers();
});

// Connect to WebSocket for real-time updates
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/@${username}`;
    console.log("Connecting to WebSocket:", wsUrl);
    
    websocket = new WebSocket(wsUrl);
    
    websocket.onopen = function(event) {
        console.log('WebSocket connection established');
        updateConnectionStatus('connected');
    };
    
    websocket.onmessage = function(event) {
        const data = JSON.parse(event.data);
        console.log("WebSocket message received:", data);
        
        if (data.event === 'new_request') {
            // Show toast notification
            const toastTime = document.getElementById('toastTime');
            const toastContent = document.getElementById('toastContent');
            
            if (toastTime) toastTime.textContent = new Date().toLocaleTimeString();
            if (toastContent) toastContent.textContent = `New ${data.method} request received`;
            
            try {
                toast.show();
            } catch (e) {
                console.error('Error showing toast:', e);
            }
            
            // Refresh the first page if we're on it
            if (currentPage === 0) {
                loadRequests();
            }
        }
    };
    
    websocket.onclose = function(event) {
        console.log("WebSocket connection closed");
        updateConnectionStatus('disconnected');
        
        // Try to reconnect after 5 seconds
        setTimeout(connectWebSocket, 5000);
    };
    
    websocket.onerror = function(error) {
        console.error('WebSocket error:', error);
        updateConnectionStatus('error');
    };
}

// Update connection status indicator
function updateConnectionStatus(status) {
    const statusDot = document.getElementById('connectionStatus');
    const statusText = document.getElementById('connectionStatusText');
    
    if (!statusDot || !statusText) return;
    
    switch(status) {
        case 'connected':
            statusDot.className = 'bg-success';
            statusText.textContent = 'Connected';
            break;
        case 'disconnected':
            statusDot.className = 'bg-danger';
            statusText.textContent = 'Disconnected';
            break;
        case 'error':
            statusDot.className = 'bg-danger';
            statusText.textContent = 'Connection Error';
            break;
        default:
            statusDot.className = 'bg-secondary';
            statusText.textContent = 'Connecting...';
    }
}

// Load webhook requests from API
function loadRequests(append = false) {
    console.log(`Loading requests for ${username}, append: ${append}`);
    
    // Show loading spinner
    const loadingSpinner = document.getElementById('loadingSpinner');
    const loadMoreContainer = document.getElementById('loadMoreContainer');
    const requestsContainer = document.getElementById('requestsContainer');
    
    if (loadingSpinner) loadingSpinner.style.display = 'flex';
    if (loadMoreContainer) loadMoreContainer.classList.add('d-none');
    
    const skip = append ? currentPage * pageSize : 0;
    
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
            
            // Ensure data is an array
            if (!Array.isArray(data)) {
                console.error("Received data is not an array:", data);
                data = [];
            }
            
            if (!append) {
                requests = data;
                currentPage = 0;
                if (requestsContainer) requestsContainer.innerHTML = '';
            } else {
                requests = requests.concat(data);
                currentPage++;
            }
            
            // Update request count
            const requestCountElem = document.getElementById('requestCount');
            if (requestCountElem) {
                requestCountElem.textContent = requests.length;
            }
            
            // Render requests
            renderRequests(append ? data : requests);
            
            // Show load more button if we got a full page
            if (data.length === pageSize && loadMoreContainer) {
                loadMoreContainer.classList.remove('d-none');
            }
            
            if (loadingSpinner) loadingSpinner.style.display = 'none';
        })
        .catch(error => {
            console.error('Error loading requests:', error);
            
            // Show error
            if (requestsContainer && !append) {
                requestsContainer.innerHTML = `
                    <div class="alert alert-danger">
                        Failed to load request history. 
                        <details>
                            <summary>Error Details</summary>
                            ${error.message}
                        </details>
                    </div>
                `;
            }
            
            if (loadingSpinner) loadingSpinner.style.display = 'none';
            
            showError('Failed to load request history');
        });
}

// Render requests to the container
function renderRequests(requestsToRender) {
    const container = document.getElementById('requestsContainer');
    
    if (!container) return;
    
    if (!requestsToRender || requestsToRender.length === 0) {
        showEmptyState(container);
        return;
    }
    
    // If this is the first render and container is empty, clear it
    if (container.children.length === 0 || container.querySelector('.empty-state')) {
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
                        <h6>Request</h6>
                        <pre class="code-block"><code class="language-json">${formatCodeBlock(req.body)}</code></pre>
                    </div>
                    <div class="col-md-6">
                        <h6>Response</h6>
                        <pre class="code-block"><code class="language-json">${formatCodeBlock(req.response)}</code></pre>
                    </div>
                </div>
                <button class="btn btn-sm btn-outline-primary mt-2 view-details-btn">
                    <i class="fas fa-search me-1"></i>View Details
                </button>
            </div>
        `;
        
        container.appendChild(cardElement);
        
        // Apply syntax highlighting
        try {
            hljs.highlightElement(cardElement.querySelector('.card-body code:nth-of-type(1)'));
            hljs.highlightElement(cardElement.querySelector('.card-body code:nth-of-type(2)'));
        } catch (error) {
            console.warn('Error highlighting code blocks:', error);
        }
    });
}

// Show empty state when there are no requests
function showEmptyState(container) {
    container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-inbox"></i>
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
    
    // Export requests to CSV
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            window.location.href = `/api/requests/@${username}/export`;
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
                        loadRequests();
                    })
                    .catch(error => {
                        console.error('Error clearing requests:', error);
                        showError('Failed to clear requests.');
                    });
                }
            });
        });
    }
    
    // Update webhook configuration
    const updateConfigBtn = document.getElementById('updateConfigBtn');
    if (updateConfigBtn) {
        updateConfigBtn.addEventListener('click', function() {
            updateWebhookConfig();
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