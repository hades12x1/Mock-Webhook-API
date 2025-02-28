// Dashboard JavaScript file
// This file is included in the dashboard.html template

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize components
    initUsernameChecker();
    initFormValidation();
    initJsonEditor();
});

// Initialize username checker
function initUsernameChecker() {
    const usernameInput = document.getElementById('username');
    const usernamePreview = document.getElementById('usernamePreview');
    const checkButton = document.getElementById('checkUsername');
    const availabilityContainer = document.getElementById('usernameAvailability');
    
    // Update preview on input
    usernameInput.addEventListener('input', function() {
        const username = this.value || 'your-username';
        usernamePreview.textContent = username;
    });
    
    // Check availability on button click
    checkButton.addEventListener('click', function() {
        const username = usernameInput.value;
        
        if (!username) {
            availabilityContainer.innerHTML = '<div class="alert alert-warning mt-2">Please enter a username</div>';
            return;
        }
        
        // Show loading
        availabilityContainer.innerHTML = '<div class="text-muted mt-2">Checking availability...</div>';
        
        // Send request to check availability
        fetch(`/api/users/check/${username}`)
            .then(response => response.json())
            .then(data => {
                if (data.available) {
                    availabilityContainer.innerHTML = '<div class="alert alert-success mt-2">Username is available!</div>';
                } else {
                    availabilityContainer.innerHTML = '<div class="alert alert-danger mt-2">Username is already taken.</div>';
                }
            })
            .catch(error => {
                availabilityContainer.innerHTML = '<div class="alert alert-danger mt-2">Error checking username.</div>';
                console.error('Error checking username:', error);
            });
    });
}

// Initialize form validation
function initFormValidation() {
    const form = document.getElementById('webhookForm');
    const usernameInput = document.getElementById('username');
    const responseInput = document.getElementById('defaultResponse');
    const minTimeInput = document.getElementById('responseTimeMin');
    const maxTimeInput = document.getElementById('responseTimeMax');
    const availabilityContainer = document.getElementById('usernameAvailability');
    
    form.addEventListener('submit', function(event) {
        let isValid = true;
        
        // Validate username
        const username = usernameInput.value;
        if (!username || !username.match(/^[a-zA-Z0-9]+$/)) {
            event.preventDefault();
            availabilityContainer.innerHTML = '<div class="alert alert-danger mt-2">Username must be alphanumeric.</div>';
            isValid = false;
        }
        
        // Validate JSON
        try {
            JSON.parse(responseInput.value);
        } catch (error) {
            event.preventDefault();
            Swal.fire({
                title: 'Invalid JSON',
                text: 'Please enter valid JSON for the default response.',
                icon: 'error'
            });
            isValid = false;
        }
        
        // Validate response times
        const minTime = parseInt(minTimeInput.value);
        const maxTime = parseInt(maxTimeInput.value);
        
        if (isNaN(minTime) || isNaN(maxTime) || minTime < 0 || maxTime < 0 || minTime > maxTime) {
            event.preventDefault();
            Swal.fire({
                title: 'Invalid Response Times',
                text: 'Min time must be less than or equal to max time, and both must be non-negative.',
                icon: 'error'
            });
            isValid = false;
        }
        
        return isValid;
    });
}

// Initialize JSON editor with formatting help
function initJsonEditor() {
    const responseInput = document.getElementById('defaultResponse');
    
    // Auto-format JSON on blur
    responseInput.addEventListener('blur', function() {
        try {
            const json = JSON.parse(this.value);
            this.value = JSON.stringify(json, null, 2);
        } catch (error) {
            // Not valid JSON, leave as is
        }
    });
    
    // Tab key behavior (insert spaces instead of changing focus)
    responseInput.addEventListener('keydown', function(event) {
        if (event.key === 'Tab') {
            event.preventDefault();
            
            const start = this.selectionStart;
            const end = this.selectionEnd;
            
            // Insert 2 spaces at cursor position
            this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
            
            // Move cursor after inserted spaces
            this.selectionStart = this.selectionEnd = start + 2;
        }
    });
}