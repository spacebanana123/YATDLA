// A variable for the server address so you can easily change it.
const SERVER_URL = ''; // The API is on the same origin, so we can use relative paths.

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
        alert('Please enter both username and password.');
        return;
    }

    try {
        const result = await authenticate(username, password, '/auth/login');
        if (result.success) {
            // On successful login, you would typically redirect the user
            // to a dashboard or another protected page.
            alert('Login successful!');
            window.location.href = '/dashboard.html'; // Example redirect
        } else {
            // On failed login, display the error message from the server.
            alert(`Login failed: ${result.message}`);
        }
    } catch (error) {
        console.error('Authentication error:', error);
        alert('An error occurred during login. Please try again.');
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
        alert('Please enter both username and password.');
        return;
    }

    try {
        const result = await authenticate(username, password, '/auth/register');
        if (result.success) {
            alert('Registration successful! Please log in.');
        } else {
            alert(`Registration failed: ${result.message}`);
        }
    } catch (error) {
        console.error('Registration error:', error);
        alert('An error occurred during registration. Please try again.');
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