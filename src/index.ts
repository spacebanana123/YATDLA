import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { verify, sign } from 'hono/jwt';
import { getAssetFromKV, NotFoundError } from '@cloudflare/kv-asset-handler';
import manifestJSON from '__STATIC_CONTENT_MANIFEST';

const assetManifest = JSON.parse(manifestJSON);

type Env = {
	YATDLA_KV: KVNamespace;
	JWT_SECRET: string;
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
	id: string; // date: YYYY-MM-DD
	userId: string;
	text: string;
	createdAt: string;
	updatedAt: string;
};


const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

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

// --- AUTHENTICATION ---

app.post('/auth/register', async c => {
	const { username, password } = await c.req.json();
	if (!username || !password) {
		return c.json({ success: false, message: 'Username and password are required' }, 400);
	}

	const existingUser = await c.env.YATDLA_KV.get(`user:${username}`);
	if (existingUser) {
		return c.json({ success: false, message: 'Username already taken' }, 409);
	}

	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hashedPassword = await hashPassword(password, salt);
	const userId = crypto.randomUUID();
	const saltHex = u8aToHex(salt);

	const newUser: User = { id: userId, username, hashedPassword, salt: saltHex };
	await c.env.YATDLA_KV.put(`user:${username}`, JSON.stringify(newUser));
	await c.env.YATDLA_KV.put(`userid:${userId}`, username);

	return c.json({ success: true, message: 'User registered successfully' });
});

app.post('/auth/login', async c => {
	const { username, password } = await c.req.json();
	if (!username || !password) {
		return c.json({ success: false, message: 'Username and password are required' }, 400);
	}

	const userString = await c.env.YATDLA_KV.get(`user:${username}`);
	if (!userString) {
		return c.json({ success: false, message: 'Invalid credentials' }, 401);
	}

	const user: User = JSON.parse(userString);
	const salt = hexToU8a(user.salt);
	const hashedPassword = await hashPassword(password, salt);

	if (!timingSafeEqual(hashedPassword, user.hashedPassword)) {
		return c.json({ success: false, message: 'Invalid credentials' }, 401);
	}

	// Lazily create the reverse mapping if it doesn't exist.
	// This handles users created before this mapping was introduced.
	const userIdKey = `userid:${user.id}`;
	const existingUsername = await c.env.YATDLA_KV.get(userIdKey);
	if (!existingUsername) {
		await c.env.YATDLA_KV.put(userIdKey, user.username);
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
	const username = await c.env.YATDLA_KV.get(`userid:${userId}`);
	if (!username) {
		return c.json({ success: false, message: 'User not found' }, 404);
	}
	return c.json({ username });
});

// Get all todos for a user
app.get('/api/todos', async c => {
	const userId = c.get('userId');
	const todosString = await c.env.YATDLA_KV.get(`todos:${userId}`);
	const todos = todosString ? JSON.parse(todosString) : [];
	return c.json(todos);
});

// Create a new todo
app.post('/api/todos', async c => {
	const userId = c.get('userId');
	const { text, dueDate } = await c.req.json<{ text: string; dueDate?: string }>();

	const todosString = await c.env.YATDLA_KV.get(`todos:${userId}`);
	const todos: Todo[] = todosString ? JSON.parse(todosString) : [];

	const newTodo: Todo = {
		id: crypto.randomUUID(),
		userId,
		text,
		completed: false,
		dueDate: dueDate || null,
		createdAt: new Date().toISOString(),
	};

	todos.push(newTodo);
	await c.env.YATDLA_KV.put(`todos:${userId}`, JSON.stringify(todos));

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

	const todosString = await c.env.YATDLA_KV.get(`todos:${userId}`);
	if (!todosString) return c.json({ success: false, message: 'Not Found' }, 404);

	let todos: Todo[] = JSON.parse(todosString);
	const todoIndex = todos.findIndex(t => t.id === todoId);

	if (todoIndex === -1) {
		return c.json({ success: false, message: 'Not Found' }, 404);
	}

	// Update fields if they are provided
	if (text !== undefined) todos[todoIndex].text = text;
	if (completed !== undefined) todos[todoIndex].completed = completed;
	if (dueDate !== undefined) todos[todoIndex].dueDate = dueDate;

	await c.env.YATDLA_KV.put(`todos:${userId}`, JSON.stringify(todos));
	return c.json(todos[todoIndex]);
});

// Delete a todo
app.delete('/api/todos/:id', async c => {
	const userId = c.get('userId');
	const todoId = c.req.param('id');

	const todosString = await c.env.YATDLA_KV.get(`todos:${userId}`);
	if (!todosString) {
		return c.json({ success: false, message: 'Not Found' }, 404);
	}

	let todos: Todo[] = JSON.parse(todosString);
	const updatedTodos = todos.filter(t => t.id !== todoId);

	if (todos.length === updatedTodos.length) {
		return c.json({ success: false, message: 'Not Found' }, 404);
	}

	await c.env.YATDLA_KV.put(`todos:${userId}`, JSON.stringify(updatedTodos));
	return new Response(null, { status: 204 });
});

// --- JOURNAL API ---

// Get a journal entry for a specific date
app.get('/api/journal/:date', async c => { // date is YYYY-MM-DD
    const userId = c.get('userId');
    const date = c.req.param('date');

    const entryString = await c.env.YATDLA_KV.get(`journal:${userId}:${date}`);
    if (!entryString) {
        // Return empty text if not found to simplify frontend logic
        return c.json({ text: '' });
    }
    const entry: JournalEntry = JSON.parse(entryString);
    return c.json(entry);
});

// Create or update a journal entry
app.post('/api/journal', async c => {
    const userId = c.get('userId');
    const { date, text } = await c.req.json<{ date: string, text: string }>();

    if (!date || text === undefined) {
        return c.json({ success: false, message: 'Date and text are required' }, 400);
    }

    const key = `journal:${userId}:${date}`;
    const now = new Date().toISOString();

    const existingEntryString = await c.env.YATDLA_KV.get(key);
    let entry: JournalEntry;

    if (existingEntryString) {
        entry = JSON.parse(existingEntryString);
        entry.text = text;
        entry.updatedAt = now;
    } else {
        entry = { id: date, userId, text, createdAt: now, updatedAt: now };
    }

    await c.env.YATDLA_KV.put(key, JSON.stringify(entry));
    return c.json({ success: true, entry });
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

    // Fetch todos for the month
    const todosString = await c.env.YATDLA_KV.get(`todos:${userId}`);
    const allTodos: Todo[] = todosString ? JSON.parse(todosString) : [];
    const filteredTodos = allTodos.filter(todo => {
        if (!todo.dueDate) return false;
        const todoDate = new Date(todo.dueDate);
        return todoDate.getUTCFullYear() === yearNum && todoDate.getUTCMonth() === monthNum - 1;
    });

    // Fetch which days in the month have journal entries
    const monthPadded = String(monthNum).padStart(2, '0');
    const prefix = `journal:${userId}:${yearNum}-${monthPadded}-`;
    const listResult = await c.env.YATDLA_KV.list({ prefix });
    const journalDays = listResult.keys.map(key => parseInt(key.name.split('-').pop() || '0'));

    return c.json({ todos: filteredTodos, journalDays });
});


// --- STATIC ASSET SERVING ---

app.get('*', async (c) => {
	try {
		return await getAssetFromKV(
			{
				request: c.req.raw,
				waitUntil: (promise) => c.executionCtx.waitUntil(promise),
			},
			{
				ASSET_NAMESPACE: c.env.__STATIC_CONTENT,
				ASSET_MANIFEST: assetManifest,
			}
		);
	} catch (e) {
		if (e instanceof NotFoundError) {
			return new Response('Not Found', { status: 404 });
		}
		return new Response('Internal Server Error', { status: 500 });
	}
});

export default app;