// A variable for the server address so you can easily change it.
const SERVER_URL = ''; // The API is on the same origin, so we can use relative paths.

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Animate in
    setTimeout(() => {
        toast.classList.add('show');
    }, 100); // Small delay to allow the element to be in the DOM for transition

    // Animate out and remove
    setTimeout(() => {
        toast.classList.remove('show');
        // Remove the element after the transition is complete
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
}

/**
 * Core function of this page, called when the form is submitted.
 * It retrieves user credentials and calls the authenticate function.
 */
async function login() {
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');

    const username = usernameInput.value;
    const password = passwordInput.value;

    // Basic client-side validation
    if (!username || !password) {
        showToast('Please enter both username and password.', 'error');
        return;
    }
    var resultMessage;
    try {
        const result = await authenticate(username, password, '/auth/login');
        if (result.success) {
            // On successful login, you would typically redirect the user
            // to a dashboard or another protected page.
            sessionStorage.setItem('toastMessage', JSON.stringify({ message: 'Login successful!', type: 'success' }));
            window.location.href = '/dashboard.html'; // Example redirect
        } else {
            // On failed login, display the error message from the server.
            showToast(`Login failed: ${result.message}`, 'error');
            resultMessage = result.message;
        }
    } catch (error) {
        console.error('Authentication error:', error);
        if(resultMessage){
            showToast(`Login failed: ${resultMessage}`, 'error');
            return;
        }
        showToast('An error occurred during login. Please try again.', 'error');
    }
}

/**
 * Handles user registration.
 */
async function register() {
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');

    const username = usernameInput.value;
    const password = passwordInput.value;

    // Basic client-side validation
    if (!username || !password) {
        showToast('Please enter both username and password.', 'error');
        return;
    }

    try {
        const result = await authenticate(username, password, '/auth/register');
        if (result.success) {
            showToast('Registration successful! Please log in.', 'success');
        } else {
            showToast(`Registration failed: ${result.message}`, 'error');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showToast('An error occurred during registration. Please try again.', 'error');
    }
}

/**
 * Sends the actual authentication request to the server.
 * @param {string} username - The user's username.
 * @param {string} password - The user's password.
 * @param {string} endpoint - The API endpoint to hit ('/auth/login' or '/auth/register').
 * @returns {Promise<Object>} - A promise that resolves with the server's response.
 */
async function authenticate(username, password, endpoint) {
    const response = await fetch(`${SERVER_URL}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
        throw new Error(`Server responded with status: ${response.status}`);
    }

    return response.json();
}

/**
 * Adds event listeners to the input boxes for "Enter" key functionality.
 */
document.addEventListener('DOMContentLoaded', () => {
    // Check for a toast message from a previous page (e.g., after logout)
    const toastMessageData = sessionStorage.getItem('toastMessage');
    if (toastMessageData) {
        try {
            const { message, type } = JSON.parse(toastMessageData);
            showToast(message, type);
            sessionStorage.removeItem('toastMessage');
        } catch (e) {
            console.error('Could not parse toast message:', e);
            sessionStorage.removeItem('toastMessage'); // Clear invalid data
        }
    }

    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    // Note: The HTML has buttons with onclick="login()" and onclick="register()"

    if (usernameInput && passwordInput) {
        usernameInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault(); // Prevent default form submission
                passwordInput.focus();
            }
        });
    }
    // The form's onsubmit handler already calls login() when Enter is pressed
    // in the password field, so an additional listener is not strictly necessary,
    // but this makes the behavior explicit in the script.
});