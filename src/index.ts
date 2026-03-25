import { Context, Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { verify, sign } from 'hono/jwt';
import { BlankInput } from 'hono/types';

type Env = {
	YATDLA_DB: D1Database;
	JWT_SECRET: string;
	YATDLA_KV: KVNamespace; 
	__STATIC_CONTENT: KVNamespace;
};

type User = {
	id: string;
	username: string;
	hashedPassword: string; // hex encoded
	salt: string; // hex encoded
};

type Todo = {
	id: string;
	userId: string;
	text: string;
	completed: boolean;
	dueDate: string | null;
	createdAt: string;
};

type JournalEntry = {
	id?: string; // date: YYYY-MM-DD. In D1, this will be the 'date' column.
	userId: string;
	text: string;
	createdAt: string;
	updatedAt: string;
};


const app = new Hono<{ Bindings: Env; Variables: { userId: string; user: User } }>();

// --- UTILITIES ---

/**
 * Hashes a password with a salt using PBKDF2.
 */
async function hashPassword(password: string, saltinput: Uint8Array): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
	const hashBuffer = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: new Uint8Array(saltinput),
			iterations: 100000,
			hash: 'SHA-256',
		},
		key,
		256
	);
	return u8aToHex(new Uint8Array(hashBuffer));
}

const u8aToHex = (a: Uint8Array) => Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');

const hexToU8a = (hex: string) =>
	new Uint8Array((hex.match(/.{1,2}/g) ?? []).map(byte => parseInt(byte, 16)));

/**
 * Compares two strings in a way that is resistant to timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		// This leaks length information, which is generally considered acceptable.
		// To mitigate this, you could hash both inputs to a fixed length and compare the hashes.
		// However, for comparing password hashes, this is a standard approach.
		return false;
	}

	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

async function checkRateLimit(c: Context<{ Bindings: Env; Variables: { userId: string; user: User; }; }, "/auth/register", BlankInput>, identifier: string, maxAttempts: number, windowSeconds: number) {
    const key = `ratelimit:${identifier}`;
    const current = await c.env.YATDLA_KV.get(key);
    const attempts = current ? parseInt(current) : 0;
    
    if (attempts >= maxAttempts) {
        return c.json({ 
            success: false, 
            message: 'Too many attempts. Please try again later.' 
        }, 429);
    }
    
    await c.env.YATDLA_KV.put(
        key, 
        (attempts + 1).toString(), 
        { expirationTtl: windowSeconds }
    );
    
    return null;
}

// --- AUTHENTICATION ---

app.post('/auth/register', async c => {
	const { username, password } = await c.req.json();
	if (!username || !password) {
		return c.json({ success: false, message: 'Username and password are required' }, 400);
	}

    const clientIP = c.req.header('CF-Connecting-IP') || 'unknown';
    
    // Rate limit by IP: 10 attempts per 15 minutes
    const ipLimit = await checkRateLimit(c, `ip:${clientIP}`, 10, 900);
    if (ipLimit) return ipLimit;

	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hashedPassword = await hashPassword(password, salt);
	const userId = crypto.randomUUID();
	const saltHex = u8aToHex(salt);

	try {
		await c.env.YATDLA_DB.prepare(
			'INSERT INTO users (id, username, hashedPassword, salt) VALUES (?, ?, ?, ?)'
		)
		.bind(userId, username, hashedPassword, saltHex)
		.run();
	} catch (e: any) {
		if (e.message?.includes('UNIQUE constraint failed')) {
			return c.json({ success: false, message: 'Username already taken' }, 409);
		}
		console.error('Registration error:', e);
		return c.json({ success: false, message: 'An error occurred during registration' }, 500);
	}

	return c.json({ success: true, message: 'User registered successfully' });
});

app.post('/auth/login', async c => {
	const { username, password } = await c.req.json();
	if (!username || !password) {
		return c.json({ success: false, message: 'Username and password are required' }, 400);
	}

    const clientIP = c.req.header('CF-Connecting-IP') || 'unknown';
    
    // Rate limit by IP: 10 attempts per 15 minutes
    const ipLimit = await checkRateLimit(c, `ip:${clientIP}`, 10, 900);
    if (ipLimit) return ipLimit;
    
    // Rate limit by username: 5 attempts per hour
    const userLimit = await checkRateLimit(c, `user:${username}`, 5, 3600);
    if (userLimit) return userLimit;

	const user = await c.env.YATDLA_DB.prepare('SELECT * FROM users WHERE username = ?')
		.bind(username)
		.first<User>();

	if (!user) {
		return c.json({ success: false, message: 'Invalid credentials' }, 401);
	}

	const salt = hexToU8a(user.salt);
	const hashedPassword = await hashPassword(password, salt);

	if (!timingSafeEqual(hashedPassword, user.hashedPassword)) {
		return c.json({ success: false, message: 'Invalid credentials' }, 401);
	}

	const payload = { sub: user.id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 }; // 1 day expiry
	const token = await sign(payload, c.env.JWT_SECRET, 'HS256');

	setCookie(c, 'auth_token', token, {
		httpOnly: true,
		secure: c.req.url.startsWith('https://'),
		sameSite: 'Lax',
		path: '/',
		maxAge: 60 * 60 * 24, // 1 day
	});

	return c.json({ success: true, message: 'Login successful' });
});

app.post('/auth/logout', async c => {
	setCookie(c, 'auth_token', '', {
		httpOnly: true,
		secure: c.req.url.startsWith('https://'),
		sameSite: 'Lax',
		path: '/',
		maxAge: 0, // Expire the cookie immediately
	});
	return c.json({ success: true, message: 'Logged out successfully' });
});

// --- API MIDDLEWARE ---

app.use('/api/*', async (c, next) => {
	const token = getCookie(c, 'auth_token');
	if (!token) {
		return c.json({ success: false, message: 'Unauthorized' }, 401);
	}
	try {
		const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
		const userId = (payload as any)?.sub;
		if (typeof userId !== 'string') {
			return c.json({ success: false, message: 'Invalid token' }, 401);
		}

		// Optional: Fetch user and attach to context. This is not strictly necessary
		// as we have the userId, but can be convenient.
		// const user = await c.env.YATDLA_DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<User>();
		// if (!user) return c.json({ success: false, message: 'User not found' }, 401);
		// c.set('user', user);

		c.set('userId', userId);
		await next();
	} catch (e) {
		return c.json({ success: false, message: 'Invalid token' }, 401);
	}
});

// --- API ROUTES ---

// Get current user's info
app.get('/api/me', async c => {
	const userId = c.get('userId');
	const user = await c.env.YATDLA_DB.prepare('SELECT username FROM users WHERE id = ?')
		.bind(userId)
		.first<{ username: string }>();

	if (!user) {
		return c.json({ success: false, message: 'User not found' }, 404);
	}
	return c.json({ username: user.username });
});

// Get all todos for a user
app.get('/api/todos', async c => {
	const userId = c.get('userId');
	const { results: todos } = await c.env.YATDLA_DB.prepare('SELECT * FROM todos WHERE userId = ? ORDER BY createdAt ASC')
		.bind(userId)
		.all<Todo>();
	return c.json(todos);
});

// Create a new todo
app.post('/api/todos', async c => {
	const userId = c.get('userId');
	const { text, dueDate } = await c.req.json<{ text: string; dueDate?: string | null }>();
	if (!text) {
		return c.json({ success: false, message: 'Todo text is required' }, 400);
	}

	const newTodo: Todo = {
		id: crypto.randomUUID(),
		userId,
		text,
		completed: false,
		dueDate: dueDate || null,
		createdAt: new Date().toISOString(),
	};

	await c.env.YATDLA_DB.prepare(
		'INSERT INTO todos (id, userId, text, completed, dueDate, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
	)
	.bind(newTodo.id, newTodo.userId, newTodo.text, newTodo.completed, newTodo.dueDate, newTodo.createdAt)
	.run();

	return c.json(newTodo, 201);
});

// Update a todo
app.put('/api/todos/:id', async c => {
	const userId = c.get('userId');
	const todoId = c.req.param('id');
	const { text, completed, dueDate } = await c.req.json<{
		text?: string;
		completed?: boolean;
		dueDate?: string | null;
	}>();

	const db = c.env.YATDLA_DB;

	const updates: string[] = [];
	const bindings: (string | number | null)[] = [];

	if (text !== undefined) {
		updates.push('text = ?');
		bindings.push(text);
	}
	if (completed !== undefined) {
		updates.push('completed = ?');
		bindings.push(completed ? 1 : 0);
	}
	if (dueDate !== undefined) {
		updates.push('dueDate = ?');
		bindings.push(dueDate);
	}

	if (updates.length === 0) {
		const todo = await db.prepare('SELECT * FROM todos WHERE id = ? AND userId = ?').bind(todoId, userId).first();
		if (!todo) return c.json({ success: false, message: 'Not Found' }, 404);
		return c.json(todo);
	}

	bindings.push(todoId, userId);

	const query = `UPDATE todos SET ${updates.join(', ')} WHERE id = ? AND userId = ? RETURNING *`;
	const updatedTodo = await db.prepare(query).bind(...bindings).first<Todo>();

	if (!updatedTodo) {
		return c.json({ success: false, message: 'Not Found' }, 404);
	}

	return c.json(updatedTodo);
});

// Delete a todo
app.delete('/api/todos/:id', async c => {
	const userId = c.get('userId');
	const todoId = c.req.param('id');

	const { success } = await c.env.YATDLA_DB.prepare('DELETE FROM todos WHERE id = ? AND userId = ?')
		.bind(todoId, userId)
		.run();

	if (!success) return c.json({ success: false, message: 'Delete failed' }, 500);
	return new Response(null, { status: 204 });
});

// --- JOURNAL API ---

// Get a journal entry for a specific date
app.get('/api/journal/:date', async c => { // date is YYYY-MM-DD
    const userId = c.get('userId');
    const date = c.req.param('date');

    const entry = await c.env.YATDLA_DB.prepare('SELECT * FROM journal_entries WHERE userId = ? AND date = ?')
        .bind(userId, date)
        .first<JournalEntry>();

    if (!entry) {
        // Return empty text if not found to simplify frontend logic
        return c.json({ text: '' });
    }
    // Add the 'id' field for frontend compatibility
    entry.id = date;
    return c.json(entry);
});

// Create or update a journal entry
app.post('/api/journal', async c => {
    const userId = c.get('userId');
    const { date, text } = await c.req.json<{ date: string, text: string }>();

    if (!date || text === undefined) {
        return c.json({ success: false, message: 'Date and text are required' }, 400);
    }

    const now = new Date().toISOString();

    const query = `
        INSERT INTO journal_entries (userId, date, text, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(userId, date) DO UPDATE SET
            text = excluded.text,
            updatedAt = excluded.updatedAt
        RETURNING *;
    `;
    const result = await c.env.YATDLA_DB.prepare(query)
        .bind(userId, date, text, now, now)
        .first<JournalEntry>();

    // Add the 'id' field for frontend compatibility
    const entry = { ...result, id: date };
    return c.json({ success: true, entry: entry });
});

// Get todos for a specific month (for the calendar)
app.get('/api/calendar', async c => {
    const userId = c.get('userId');
    const { year, month } = c.req.query(); // e.g., ?year=2024&month=3

    if (!year || !month) {
        return c.json({ success: false, message: 'Year and month query parameters are required' }, 400);
    }

    const yearNum = parseInt(year);
    const monthNum = parseInt(month);

	//Checks against SQL injection as we are packing in a monthStr by hand.
	if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    	return c.json({ error: 'Invalid parameters' }, 400);
	}

    const monthStr = `${yearNum}-${String(monthNum).padStart(2, '0')}`;

    // Fetch todos for the month
    const todosStmt = c.env.YATDLA_DB.prepare(
        "SELECT * FROM todos WHERE userId = ? AND strftime('%Y-%m', dueDate) = ?"
    ).bind(userId, monthStr);

    // Fetch which days in the month have journal entries
    const journalStmt = c.env.YATDLA_DB.prepare(
        "SELECT date FROM journal_entries WHERE userId = ? AND strftime('%Y-%m', date) = ?"
    ).bind(userId, monthStr);

    const [todosResult, journalResult] = await c.env.YATDLA_DB.batch([todosStmt, journalStmt]);

    const todos = todosResult.results as Todo[];
    const journalDays = (journalResult.results as { date: string }[]).map(r => new Date(r.date).getUTCDate());

    return c.json({ todos, journalDays });
});

export default app;