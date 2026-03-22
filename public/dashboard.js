document.addEventListener('DOMContentLoaded', () => {
    const todoList = document.getElementById('todo-list');
    const newTodoForm = document.getElementById('new-todo-form');
    const newTodoText = document.getElementById('new-todo-text');
    const newTodoDueDate = document.getElementById('new-todo-due-date');
    const journalModal = document.getElementById('journal-modal');
    const journalDateDisplay = document.getElementById('journal-date-display');
    const journalDateHidden = document.getElementById('journal-date-hidden');
    const journalText = document.getElementById('journal-text');
    const saveJournalButton = document.getElementById('save-journal-button');
    const closeJournalButton = document.getElementById('close-journal-button');
    const logoutButton = document.getElementById('logout-button');
    const mainHeader = document.getElementById('main-header');
    const editTodoModal = document.getElementById('edit-todo-modal');
    const editTodoText = document.getElementById('edit-todo-text');
    const editTodoDueDate = document.getElementById('edit-todo-due-date');
    const editTodoId = document.getElementById('edit-todo-id');
    const saveTodoButton = document.getElementById('save-todo-button');
    const closeEditTodoButton = document.getElementById('close-edit-todo-button');

    let state = { todos: [] };

    async function fetchUser() {
        try {
            const response = await fetch('/api/me');
            if (!response.ok) return; // Silently fail, the default header is fine.
            const user = await response.json();
            if (user.username) mainHeader.textContent = `${user.username}'s To-Do List`;
        } catch (error) {
            console.error('Error fetching user:', error);
        }
    }

    // Fetch and display todos
    async function fetchTodos() {
        try {
            const response = await fetch('/api/todos');
            if (response.status === 401) {
                alert('Session expired. Please log in again.');
                window.location.href = '/index.html';
                return;
            }
            if (!response.ok) {
                throw new Error(`Failed to fetch todos: ${response.statusText}`);
            }
            state.todos = await response.json();
            renderTodos(state.todos);
        } catch (error) {
            console.error('Error fetching todos:', error);
            alert('Could not fetch todos.');
        }
    }

    /**
     * Correctly parses a 'YYYY-MM-DD' string into a local Date object.
     * new Date('YYYY-MM-DD') parses as UTC, which can cause off-by-one-day errors
     * when converting back to a local date string.
     * @param {string} dateString - The date string in 'YYYY-MM-DD' format.
     * @returns {Date}
     */
    function parseLocalDate(dateString) {
        // By appending T00:00:00, we explicitly tell the parser to treat
        // the date string as being in the local timezone, not UTC.
        return new Date(`${dateString}T00:00:00`);
    }

    // Create a single <li> element for a todo
    function createTodoListItem(todo) {
        const li = document.createElement('li');
        li.dataset.id = todo.id;

        const textSpan = document.createElement('span');
        const dueDateText = todo.dueDate ? `(Due: ${parseLocalDate(todo.dueDate).toLocaleDateString()})` : '';
        textSpan.textContent = `${todo.text} ${dueDateText}`;
        textSpan.style.textDecoration = todo.completed ? 'line-through' : 'none';
        textSpan.className = 'todo-text';

        // Double-click to open the edit modal
        textSpan.ondblclick = () => openEditTodoModal(todo);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'todo-buttons';

        const toggleButton = document.createElement('button');
        toggleButton.textContent = todo.completed ? 'Undo' : 'Complete';
        toggleButton.className = 'button todo-toggle-button';
        toggleButton.onclick = () => toggleTodo(todo.id, !todo.completed);

        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Delete';
        deleteButton.className = 'button todo-delete-button';
        deleteButton.onclick = () => deleteTodo(todo.id);

        li.appendChild(textSpan);
        buttonContainer.appendChild(toggleButton);
        buttonContainer.appendChild(deleteButton);
        li.appendChild(buttonContainer);

        return li;
    }

    // Render todos to the list
    function renderTodos(todos) {
        todoList.innerHTML = '';
        const sortedTodos = [...todos].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        for (const todo of sortedTodos) {
            const li = createTodoListItem(todo);
            todoList.appendChild(li);
        }
    }

    // Add a new todo
    newTodoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = newTodoText.value.trim();
        const dueDate = newTodoDueDate.value;
        if (!text) return;

        try {
            const response = await fetch('/api/todos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, dueDate: dueDate || null }),
            });
            if (!response.ok) throw new Error('Failed to add todo');
            const newTodo = await response.json();
            state.todos.push(newTodo);
            const li = createTodoListItem(newTodo);
            todoList.appendChild(li); // Append new item instead of full re-render
            newTodoText.value = '';
            newTodoDueDate.value = '';
            renderCalendar();
        } catch (error) {
            console.error('Error adding todo:', error);
            alert('Could not add todo.');
        }
    });

    // Toggle todo completion status
    async function toggleTodo(id, completed) {
        try {
            const response = await fetch(`/api/todos/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completed }),
            });
            if (!response.ok) throw new Error('Failed to update todo');
            const updatedTodo = await response.json();

            // Update local state
            const index = state.todos.findIndex(t => t.id === id);
            if (index !== -1) state.todos[index] = updatedTodo;

            // Update the specific item in the DOM
            const oldLi = todoList.querySelector(`li[data-id="${id}"]`);
            if (oldLi) oldLi.replaceWith(createTodoListItem(updatedTodo));
            await renderCalendar();
        } catch (error) {
            console.error('Error updating todo:', error);
            alert('Could not update todo.');
        }
    }

    // Delete a todo
    async function deleteTodo(id) {
        if (!confirm('Are you sure you want to delete this to-do?')) return;
        try {
            const response = await fetch(`/api/todos/${id}`, {
                method: 'DELETE',
            });
            if (!response.ok) throw new Error('Failed to delete todo');            
            // Update local state
            state.todos = state.todos.filter(t => t.id !== id);

            // Remove from DOM
            const li = todoList.querySelector(`li[data-id="${id}"]`);
            if (li) li.remove();
            await renderCalendar();
        } catch (error) {
            console.error('Error deleting todo:', error);
            alert('Could not delete todo.');
        }
    }

    // --- Edit Todo Modal ---

    function openEditTodoModal(todo) {
        editTodoId.value = todo.id;
        editTodoText.value = todo.text;
        editTodoDueDate.value = todo.dueDate || '';
        editTodoModal.style.display = 'flex';
    }

    function closeEditTodoModal() {
        editTodoModal.style.display = 'none';
    }

    async function saveTodo() {
        const id = editTodoId.value;
        const text = editTodoText.value.trim();
        const dueDate = editTodoDueDate.value;

        if (!text) {
            alert('To-do text cannot be empty.');
            return;
        }

        try {
            // We can reuse the PUT endpoint. We are not updating the 'completed' status here.
            const response = await fetch(`/api/todos/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, dueDate: dueDate || null }),
            });
            if (!response.ok) throw new Error('Failed to update todo');
            const updatedTodo = await response.json();

            // Update local state
            const index = state.todos.findIndex(t => t.id === id);
            if (index !== -1) state.todos[index] = { ...state.todos[index], ...updatedTodo };

            // Update the specific item in the DOM
            const oldLi = todoList.querySelector(`li[data-id="${id}"]`);
            if (oldLi) oldLi.replaceWith(createTodoListItem(state.todos[index]));

            closeEditTodoModal();
            await renderCalendar();
        } catch (error) {
            console.error('Error updating todo:', error);
            alert('Could not update todo.');
        }
    }

    // Initial fetch
    fetchTodos();
    fetchUser();

    // --- CALENDAR ---
    const calendarDiv = document.getElementById('calendar');
    let calendarDate = new Date();

    async function renderCalendar() {
        // calendarDiv.innerHTML = ''; // MOVED to prevent jarring refresh
        const year = calendarDate.getFullYear();
        const month = calendarDate.getMonth(); // 0-indexed

        // Create a fragment to build the new calendar in memory
        const newCalendar = document.createDocumentFragment();

        // Fetch todos for the current month
        let monthTodos = {};
        let journalDays = [];
        try {
            const response = await fetch(`/api/calendar?year=${year}&month=${month + 1}`);
            if (response.status === 401) {
                // The main fetchTodos function already handles this, but good to be safe
                alert('Session expired. Please log in again.');
                window.location.href = '/index.html';
                return;
            }
            if (!response.ok) throw new Error('Failed to fetch calendar events');
            const calendarData = await response.json();
            const todos = calendarData.todos;
            journalDays = calendarData.journalDays;

            todos.forEach(todo => {
                // dueDate is 'YYYY-MM-DD'. new Date() will parse it as UTC.
                const day = new Date(todo.dueDate).getUTCDate();
                if (!monthTodos[day]) {
                    monthTodos[day] = [];
                }
                monthTodos[day].push(todo);
            });
        } catch (error) {
            console.error("Error fetching calendar todos:", error);
            // Don't block calendar rendering if todos fail to load
        }

        // --- Calendar Header ---
        const header = document.createElement('div');
        header.className = 'calendar-header';

        const prevButton = document.createElement('button');
        prevButton.textContent = '<';
        prevButton.className = 'button';
        prevButton.onclick = () => {
            calendarDate.setMonth(calendarDate.getMonth() - 1);
            renderCalendar();
        };

        const monthYearLabel = document.createElement('h2');
        monthYearLabel.textContent = `${calendarDate.toLocaleString('default', { month: 'long' })} ${year}`;

        const nextButton = document.createElement('button');
        nextButton.textContent = '>';
        nextButton.className = 'button';
        nextButton.onclick = () => {
            calendarDate.setMonth(calendarDate.getMonth() + 1);
            renderCalendar();
        };

        header.appendChild(prevButton);
        header.appendChild(monthYearLabel);
        header.appendChild(nextButton);
        newCalendar.appendChild(header);

        // --- Calendar Grid ---
        const grid = document.createElement('div');
        grid.className = 'calendar-grid';

        // Day headers
        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        daysOfWeek.forEach(day => {
            const dayHeader = document.createElement('div');
            dayHeader.className = 'calendar-day-header';
            dayHeader.textContent = day;
            grid.appendChild(dayHeader);
        });

        // Day cells
        const firstDayOfMonth = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // Blank cells for days before the 1st
        for (let i = 0; i < firstDayOfMonth; i++) {
            grid.appendChild(document.createElement('div'));
        }

        // Cells for each day of the month
        for (let day = 1; day <= daysInMonth; day++) {
            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day';
            const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            dayCell.dataset.date = dateString;
            dayCell.onclick = () => openJournalModal(year, month, day);

            // Add a visual indicator if a journal entry exists for this day
            if (journalDays.includes(day)) {
                dayCell.classList.add('has-journal');
            }

            const dayNumber = document.createElement('div');
            dayNumber.className = 'day-number';
            dayNumber.textContent = day;
            dayCell.appendChild(dayNumber);

            if (monthTodos[day]) {
                monthTodos[day].forEach(todo => {
                    const todoEl = document.createElement('div');
                    todoEl.className = 'calendar-todo';
                    todoEl.textContent = todo.text;
                    if (todo.completed) todoEl.classList.add('completed');
                    todoEl.onclick = (e) => {
                        // Prevent the click from bubbling up to the parent day cell,
                        // which would otherwise open the journal modal.
                        e.stopPropagation();
                        openEditTodoModal(todo);
                    };
                    dayCell.appendChild(todoEl);
                });
            }
            grid.appendChild(dayCell);
        }

        newCalendar.appendChild(grid);

        // Now that the new calendar is built in memory, clear the old one and append the new one.
        calendarDiv.innerHTML = '';
        calendarDiv.appendChild(newCalendar);
    }

    function openJournalModal(year, month, day) {
        const date = new Date(year, month, day);
        const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        journalDateDisplay.textContent = date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        journalDateHidden.value = dateString;
        journalText.value = ''; // Clear previous text while new one loads
    
        // Fetch existing journal entry
        fetch(`/api/journal/${dateString}`)
            .then(res => res.ok ? res.json() : Promise.reject('Failed to fetch journal'))
            .then(data => {
                if (data && data.text) {
                    journalText.value = data.text;
                }
            })
            .catch(err => console.error('Error fetching journal entry:', err));
    
        journalModal.style.display = 'flex';
    }

    function closeJournalModal() {
        journalModal.style.display = 'none';
    }

    async function saveJournal() {
        const date = journalDateHidden.value;
        const text = journalText.value;
    
        try {
            const response = await fetch('/api/journal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date, text }),
            });
            if (!response.ok) throw new Error('Failed to save journal');
            const { entry } = await response.json();

            closeJournalModal();
            // Instead of a full re-render, just update the class on the specific day
            const dayCell = calendarDiv.querySelector(`.calendar-day[data-date="${entry.id}"]`);
            if (dayCell && entry.text) {
                dayCell.classList.add('has-journal');
            } else if (dayCell) {
                dayCell.classList.remove('has-journal'); // In case the journal was emptied
            }
        } catch (error) {
            console.error('Error saving journal:', error);
            alert('Could not save journal entry.');
        }
    }

    async function logout() {
        try {
            const response = await fetch('/auth/logout', { method: 'POST' });
            if (!response.ok) {
                throw new Error('Logout failed');
            }
            const result = await response.json();
            if (result.success) {
                alert('You have been logged out.');
                window.location.href = '/index.html';
            } else {
                alert('Logout failed. Please try again.');
            }
        } catch (error) {
            console.error('Error during logout:', error);
            alert('An error occurred during logout.');
        }
    }

    // Event Listeners for modal
    closeJournalButton.onclick = closeJournalModal;
    saveJournalButton.onclick = saveJournal;
    journalModal.addEventListener('click', (e) => e.target === journalModal && closeJournalModal());
    closeEditTodoButton.onclick = closeEditTodoModal;
    saveTodoButton.onclick = saveTodo;
    editTodoModal.addEventListener('click', (e) => e.target === editTodoModal && closeEditTodoModal());
    logoutButton.addEventListener('click', logout);

    renderCalendar();
});