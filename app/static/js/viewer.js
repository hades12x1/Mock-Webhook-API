// Viewer JavaScript file
// This file is included in the viewer.html template

// Globals
let websocket;
let requests = [];
let currentPage = 0;
const pageSize = 10;
let username = '';
let requestModal;
let toast;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Get username from URL
    username = window.location.pathname.split('@')[1];
    
    // Initialize Bootstrap components
    requestModal = new bootstrap.Modal(document.getElementById('requestModal'));
    toast = new bootstrap.Toast(document.getElementById('newRequestToast'));
    
    // Setup code highlighting
    document.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });
    
    // Setup WebSocket connection
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
    
    websocket = new WebSocket(wsUrl);
    
    websocket.onopen = function(event) {
        console.log('WebSocket connection established');
        document.getElementById('connectionStatus').textContent = 'Connected';
        document.getElementById('connectionStatus').classList.remove('bg-secondary', 'bg-danger');
        document.getElementById('connectionStatus').classList.add('bg-success');
    };
    
    websocket.onmessage = function(event) {
        const data = JSON.parse(event.data);
        
        if (data.event === 'new_request') {
            // Show toast notification
            document.getElementById('toastTime').textContent = new Date().toLocaleTimeString();
            document.getElementById('toastContent').textContent = `New request received`;
            toast.show();
            
            // Refresh the first page if we're on it
            if (currentPage === 0) {
                loadRequests();
            }
        }
    };
    
    websocket.onclose = function(event) {
        document.getElementById('connectionStatus').textContent = 'Disconnected';
        document.getElementById('connectionStatus').classList.remove('bg-success');
        document.getElementById('connectionStatus').classList.add('bg-danger');
        
        // Try to reconnect after 5 seconds
        setTimeout(function() {
            connectWebSocket();
        }, 5000);
    };
    
    websocket.onerror = function(error) {
        console.error('WebSocket error:', error);
        document.getElementById('connectionStatus').textContent = 'Error';
        document.getElementById('connectionStatus').classList.remove('bg-success');
        document.getElementById('connectionStatus').classList.add('bg-danger');
    };
}

// Load webhook requests from API
function loadRequests(append = false) {
    document.getElementById('loadingSpinner').style.display = 'flex';
    document.getElementById('loadMoreContainer').classList.add('d-none');
    
    const skip = append ? currentPage * pageSize : 0;
    
    fetch(`/api/requests/@${username}?limit=${pageSize}&skip=${skip}`)
        .then(response => response.json())
        .then(data => {
            if (!append) {
                requests = data;
                currentPage = 0;
                document.getElementById('requestsContainer').innerHTML = '';
            } else {
                requests = requests.concat(data);
                currentPage++;
            }
            
            // Update request count
            document.getElementById('requestCount').textContent = requests.length;
            
            // Render requests
            renderRequests(append ? data : requests);
            
            // Show load more button if we got a full page
            if (data.length === pageSize) {
                document.getElementById('loadMoreContainer').classList.remove('d-none');
            }
            
            document.getElementById('loadingSpinner').style.display = 'none';
        })
        .catch(error => {
            console.error('Error loading requests:', error);
            document.getElementById('loadingSpinner').style.display = 'none';
            
            Swal.fire({
                title: 'Error',
                text: 'Failed to load request history.',
                icon: 'error'
            });
        });
}

// Render requests to the container
function renderRequests(requestsToRender) {
    const container = document.getElementById('requestsContainer');
    
    if (requestsToRender.length === 0 && requests.length === 0) {
        container.innerHTML = '<div class="alert alert-info">No requests yet. Send a request to your webhook URL to see it here.</div>';
        return;
    }
    
    for (const req of requestsToRender) {
        const requestTime = new Date(req.request_time).toLocaleString();
        
        const cardHtml = `
            <div class="card shadow-sm mb-3 request-card" data-id="${req.id}">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <div>
                        <span class="badge badge-${req.method}">${req.method}</span>
                        <span class="ms-2">${req.path}</span>
                    </div>
                    <div>
                        <span class="text-muted me-2">${requestTime}</span>
                        <span class="badge bg-secondary">${req.response_time} ms</span>
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
        container.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }
}

// Format code blocks for display
function formatCodeBlock(content) {
    if (!content) return 'null';
    
    if (typeof content === 'object') {
        return JSON.stringify(content, null, 2);
    }
    
    try {
        // Try to parse as JSON
        return JSON.stringify(JSON.parse(content), null, 2);
    } catch (e) {
        // Return as is
        return content;
    }
}

// Show request details modal
function showRequestDetails(requestId) {
    const request = requests.find(r => r.id === requestId);
    
    if (!request) return;
    
    const modalContent = document.getElementById('modalContent');
    const requestTime = new Date(request.request_time).toLocaleString();
    
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
                        <p><strong>Request ID:</strong> ${request.id}</p>
                        <p><strong>Method:</strong> ${request.method}</p>
                        <p><strong>Path:</strong> ${request.path}</p>
                        <p><strong>Time:</strong> ${requestTime}</p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>Response Time:</strong> ${request.response_time} ms</p>
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
    
    // Highlight code blocks
    modalContent.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });
    
    // Set modal title
    document.getElementById('modalTitle').textContent = `${request.method} Request Details`;
    
    // Show modal
    requestModal.show();
}

// Setup event handlers
function setupEventHandlers() {
    // Copy webhook URL to clipboard
    document.getElementById('copyUrlBtn').addEventListener('click', function() {
        const webhookUrl = document.getElementById('webhookUrl').value;
        navigator.clipboard.writeText(webhookUrl).then(function() {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: 'URL copied to clipboard!',
                showConfirmButton: false,
                timer: 1500
            });
        });
    });
    
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
    document.getElementById('loadMoreBtn').addEventListener('click', function() {
        loadRequests(true);
    });
    
    // Export requests to CSV
    document.getElementById('exportBtn').addEventListener('click', function() {
        window.location.href = `/api/requests/@${username}/export`;
    });
    
    // Clear all requests
    document.getElementById('clearBtn').addEventListener('click', function() {
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