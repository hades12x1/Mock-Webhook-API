// Viewer JavaScript file
// This file is included in the viewer.html template

// Ensure hljs is defined
if (typeof hljs === 'undefined') {
    console.warn('Highlight.js not loaded. Defining a fallback.');
    window.hljs = {
        highlightElement: function(block) {
            console.log('Fallback highlight for:', block);
        },
        highlightAll: function() {
            console.log('Fallback highlight all');
        }
    };
}

// Ensure SweetAlert2 is available
if (typeof Swal === 'undefined') {
    console.warn('SweetAlert2 not loaded. Defining a fallback.');
    window.Swal = {
        fire: function(options) {
            console.log('Fallback Swal.fire:', options);
            alert(options.title + '\n' + (options.text || ''));
        }
    };
}

// Globals
let websocket;
let requests = [];
let currentPage = 0;
const pageSize = 100; // Increased to fetch more requests
let username = '';
let requestModal;
let toast;

// Debug function to log messages
function debugLog(...messages) {
    console.log('[Viewer Debug]', ...messages);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Debug: Log initialization start
    debugLog('Initializing viewer script');
    
    // Get username from URL
    username = window.location.pathname.split('@')[1];
    debugLog('Extracted username:', username);
    
    // Validate username
    if (!username) {
        debugLog('Invalid username');
        Swal.fire({
            title: 'Error',
            text: 'Invalid username',
            icon: 'error'
        });
        return;
    }
    
    // Initialize Bootstrap components
    try {
        requestModal = new bootstrap.Modal(document.getElementById('requestModal'));
        toast = new bootstrap.Toast(document.getElementById('newRequestToast'));
    } catch (error) {
        debugLog('Error initializing Bootstrap components:', error);
    }
    
    // Setup code highlighting with fallback
    try {
        document.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    } catch (error) {
        console.warn('Error highlighting code blocks:', error);
    }
    
    // Debug: Log before connecting WebSocket
    debugLog('About to connect WebSocket');
    
    // Setup WebSocket connection
    connectWebSocket();
    
    // Debug: Log before loading requests
    debugLog('About to load requests');
    
    // Load initial requests with detailed logging
    loadRequests();
    
    // Setup event handlers
    setupEventHandlers();
    
    // Debug: Log initialization complete
    debugLog('Viewer script initialization complete');
});

// Connect to WebSocket for real-time updates
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/@${username}`;
    debugLog("Connecting to WebSocket:", wsUrl);
    
    websocket = new WebSocket(wsUrl);
    
    websocket.onopen = function(event) {
        debugLog('WebSocket connection established');
        const connectionStatus = document.getElementById('connectionStatus');
        if (connectionStatus) {
            connectionStatus.textContent = 'Connected';
            connectionStatus.classList.remove('bg-secondary', 'bg-danger');
            connectionStatus.classList.add('bg-success');
        }
    };
    
    websocket.onmessage = function(event) {
        const data = JSON.parse(event.data);
        debugLog("WebSocket message received:", data);
        
        if (data.event === 'new_request') {
            // Show toast notification
            const toastTime = document.getElementById('toastTime');
            const toastContent = document.getElementById('toastContent');
            if (toastTime) toastTime.textContent = new Date().toLocaleTimeString();
            if (toastContent) toastContent.textContent = `New request received`;
            
            // Trigger toast if available
            if (toast) {
                try {
                    toast.show();
                } catch (toastError) {
                    debugLog('Error showing toast:', toastError);
                }
            }
            
            // Refresh the first page if we're on it
            if (currentPage === 0) {
                loadRequests();
            }
        }
    };
    
    websocket.onclose = function(event) {
        debugLog("WebSocket connection closed");
        const connectionStatus = document.getElementById('connectionStatus');
        if (connectionStatus) {
            connectionStatus.textContent = 'Disconnected';
            connectionStatus.classList.remove('bg-success');
            connectionStatus.classList.add('bg-danger');
        }
        
        // Try to reconnect after 5 seconds
        setTimeout(function() {
            connectWebSocket();
        }, 5000);
    };
    
    websocket.onerror = function(error) {
        debugLog('WebSocket error:', error);
        const connectionStatus = document.getElementById('connectionStatus');
        if (connectionStatus) {
            connectionStatus.textContent = 'Error';
            connectionStatus.classList.remove('bg-success');
            connectionStatus.classList.add('bg-danger');
        }
    };
}

// Load webhook requests from API with extensive error handling
function loadRequests(append = false) {
    debugLog(`Loading requests for username: ${username}, Append: ${append}`);
    
    // Show loading spinner
    const loadingSpinner = document.getElementById('loadingSpinner');
    const loadMoreContainer = document.getElementById('loadMoreContainer');
    const requestsContainer = document.getElementById('requestsContainer');
    
    if (loadingSpinner) loadingSpinner.style.display = 'flex';
    if (loadMoreContainer) loadMoreContainer.classList.add('d-none');
    
    const skip = append ? currentPage * pageSize : 0;
    
    // Detailed fetch with error handling
    fetch(`/api/requests/@${username}?limit=${pageSize}&skip=${skip}`)
        .then(response => {
            debugLog("Fetch response status:", response.status);
            
            // Check if response is OK
            if (!response.ok) {
                // Attempt to parse error message
                return response.json().then(errData => {
                    debugLog("API Error:", errData);
                    throw new Error(`API Error: ${JSON.stringify(errData)}`);
                }).catch(() => {
                    throw new Error(`HTTP error! status: ${response.status}`);
                });
            }
            
            return response.json();
        })
        .then(data => {
            debugLog("Received requests:", data);
            
            // Ensure data is an array
            if (!Array.isArray(data)) {
                debugLog("Received data is not an array:", data);
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
                debugLog(`Updated request count: ${requests.length}`);
            }
            
            // Render requests
            renderRequests(append ? data : requests);
            
            // Show load more button if we got a full page
            if (data.length === pageSize && loadMoreContainer) {
                loadMoreContainer.classList.remove('d-none');
            }
            
            if (loadingSpinner) loadingSpinner.style.display = 'none';
            
            // Debug: Log rendering complete
            debugLog('Request loading and rendering complete');
        })
        .catch(error => {
            debugLog('Error loading requests:', error);
            
            // Clear previous content and show error
            if (requestsContainer) {
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
            
            // Show error via SweetAlert
            Swal.fire({
                title: 'Error',
                html: `Failed to load request history. 
                    <br><small>${error.message}</small>`,
                icon: 'error',
                showConfirmButton: true
            });
        });
}

// Render requests to the container with robust error handling
function renderRequests(requestsToRender) {
    debugLog("Rendering requests:", requestsToRender);
    
    const container = document.getElementById('requestsContainer');
    
    if (!container) {
        debugLog('Request container not found');
        return;
    }
    
    if (!requestsToRender || requestsToRender.length === 0) {
        debugLog('No requests to render');
        container.innerHTML = `
            <div class="alert alert-info">
                No requests yet. Send a request to your webhook URL: 
                <code>http://localhost:8080/api/@${username}</code>
            </div>
        `;
        return;
    }
    
    debugLog(`Rendering ${requestsToRender.length} requests`);
    
    requestsToRender.forEach((req, index) => {
        debugLog(`Rendering request ${index + 1}:`, req);
        
        // Ensure all required fields exist
        const method = req.method || 'UNKNOWN';
        const path = req.path || '/';
        const requestTime = req.request_time ? new Date(req.request_time).toLocaleString() : 'Unknown Time';
        const responseTime = req.response_time || 0;
        
        const cardHtml = `
            <div class="card shadow-sm mb-3 request-card" data-id="${req.id || ''}">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <div>
                        <span class="badge badge-${method}">${method}</span>
                        <span class="ms-2">${path}</span>
                    </div>
                    <div>
                        <span class="text-muted me-2">${requestTime}</span>
                        <span class="badge bg-secondary">${responseTime} ms</span>
                    </div>
                </div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-6">
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
            </div>
        `;
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHtml;
        container.appendChild(tempDiv.firstElementChild);
        
        // Highlight code blocks
        try {
            container.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        } catch (error) {
            console.warn('Error highlighting code blocks:', error);
        }
    });

    debugLog(`Finished rendering ${requestsToRender.length} requests`);
}

// Format code blocks for display
function formatCodeBlock(content) {
    debugLog("Formatting code block:", content);
    
    if (!content) return 'null';
    
    if (typeof content === 'object') {
        return JSON.stringify(content, null, 2);
    }
    
    try {
        // Try to parse as JSON
        return JSON.stringify(JSON.parse(content), null, 2);
    } catch (e) {
        // Return as is
        return content || 'null';
    }
}

// Setup event handlers
function setupEventHandlers() {
    // Copy webhook URL to clipboard
    const copyUrlBtn = document.getElementById('copyUrlBtn');
    if (copyUrlBtn) {
        copyUrlBtn.addEventListener('click', function() {
            const webhookUrl = document.getElementById('webhookUrl');
            if (webhookUrl) {
                navigator.clipboard.writeText(webhookUrl.value).then(function() {
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: 'URL copied to clipboard!',
                        showConfirmButton: false,
                        timer: 1500
                    });
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
                        Swal.fire({
                            title: 'Success',
                            text: `Deleted ${data.deleted_count} requests.`,
                            icon: 'success'
                        });
                        
                        // Reload requests
                        loadRequests();
                    })
                    .catch(error => {
                        console.error('Error clearing requests:', error);
                        
                        Swal.fire({
                            title: 'Error',
                            text: 'Failed to clear requests.',
                            icon: 'error'
                        });
                    });
                }
            });
        });
    }
}

// Show request details
function showRequestDetails(requestId) {
    debugLog('Showing details for request:', requestId);
    
    const request = requests.find(r=> r.id === requestId);
    
    if (!request) {
        debugLog('Request not found for ID:', requestId);
        Swal.fire({
            title: 'Error',
            text: 'Request details not found',
            icon: 'error'
        });
        return;
    }
    
    const modalContent = document.getElementById('modalContent');
    const modalTitle = document.getElementById('modalTitle');
    
    if (!modalContent || !modalTitle) {
        debugLog('Modal elements not found');
        return;
    }
    
    // Convert request time to localized string
    const requestTime = request.request_time ? 
        new Date(request.request_time).toLocaleString() : 
        'Unknown Time';
    
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
                        data-bs-target="#body" type="button" role="tab">Body</button>
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
                        <p><strong>Request ID:</strong> ${request.id || 'N/A'}</p>
                        <p><strong>Method:</strong> ${request.method || 'N/A'}</p>
                        <p><strong>Path:</strong> ${request.path || 'N/A'}</p>
                        <p><strong>Time:</strong> ${requestTime}</p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>Response Time:</strong> ${request.response_time || 0} ms</p>
                        <p><strong>Query Parameters:</strong></p>
                        <pre class="bg-light p-2 rounded"><code class="language-json">${formatCodeBlock(request.query_params)}</code></pre>
                    </div>
                </div>
            </div>
            
            <div class="tab-pane fade" id="headers" role="tabpanel">
                <pre class="bg-light p-2 rounded"><code class="language-json">${formatCodeBlock(request.headers)}</code></pre>
            </div>
            
            <div class="tab-pane fade" id="body" role="tabpanel">
                <pre class="bg-light p-2 rounded"><code class="language-json">${formatCodeBlock(request.body)}</code></pre>
            </div>
            
            <div class="tab-pane fade" id="response" role="tabpanel">
                <pre class="bg-light p-2 rounded"><code class="language-json">${formatCodeBlock(request.response)}</code></pre>
            </div>
        </div>
    `;
    
    // Set modal title
    modalTitle.textContent = `${request.method || 'Request'} Details`;
    
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
            debugLog('Request modal not initialized');
        }
    } catch (error) {
        console.error('Error showing modal:', error);
        Swal.fire({
            title: 'Error',
            text: 'Could not open request details',
            icon: 'error'
        });
    }
}

// Ensure the entire script is loaded and initialized
debugLog('Viewer script fully loaded');