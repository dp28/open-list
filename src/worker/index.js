// Cloudflare Worker - Shopping List API
// Minimal, dependency-free sync server

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    console.log(`Request: ${request.method} ${request.url}`);
    console.log(`Parsed pathname: "${url.pathname}"`);
    console.log(`Starts with /api/: ${url.pathname.startsWith('/api/')}`);
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Serve static assets for non-API routes
      if (!url.pathname.startsWith('/api/')) {
        console.log('Serving static asset');
        return env.ASSETS.fetch(request);
      }

      // Extract list ID and PIN from headers
      const listId = request.headers.get('X-List-ID');
      const pin = request.headers.get('X-List-PIN');

      console.log(`API route: ${url.pathname}, Method: ${request.method}`);

      // Health check
      if (url.pathname === '/api/health') {
        return json({ status: 'ok', timestamp: new Date().toISOString() }, corsHeaders);
      }

      // Routes
      if (url.pathname === '/api/list' && request.method === 'POST') {
        console.log('Matched: createList');
        return createList(request, env, corsHeaders);
      }
      
      if (url.pathname === '/api/list' && request.method === 'GET') {
        if (!listId || !pin) return error('Missing credentials', 401, corsHeaders);
        return getList(listId, pin, env, corsHeaders);
      }
      
      if (url.pathname === '/api/sync' && request.method === 'POST') {
        if (!listId || !pin) return error('Missing credentials', 401, corsHeaders);
        return syncChanges(listId, pin, request, env, corsHeaders);
      }
      
      if (url.pathname === '/api/items' && request.method === 'POST') {
        if (!listId || !pin) return error('Missing credentials', 401, corsHeaders);
        return addItem(listId, pin, request, env, corsHeaders);
      }
      
      if (url.pathname.startsWith('/api/items/') && request.method === 'DELETE') {
        if (!listId || !pin) return error('Missing credentials', 401, corsHeaders);
        const itemId = url.pathname.split('/').pop();
        return deleteItem(listId, pin, itemId, env, corsHeaders);
      }

      console.log('No route matched - returning 404');
      return json({ error: 'Not found', path: url.pathname, method: request.method }, corsHeaders, 404);
    } catch (err) {
      console.error('Error:', err);
      return error(err.message, 500, corsHeaders);
    }
  }
};

async function createList(request, env, corsHeaders) {
  const body = await request.json();
  const { name, pin } = body;
  
  if (!name || !pin) {
    return error('Name and PIN required', 400, corsHeaders);
  }

  const id = generateId();
  
  await env.DB.prepare(
    'INSERT INTO lists (id, name, pin) VALUES (?, ?, ?)'
  ).bind(id, name, pin).run();

  return json({ id, name }, corsHeaders);
}

async function getList(listId, pin, env, corsHeaders) {
  // Verify credentials
  const list = await env.DB.prepare(
    'SELECT * FROM lists WHERE id = ? AND pin = ?'
  ).bind(listId, pin).first();

  if (!list) {
    return error('Invalid credentials', 401, corsHeaders);
  }

  // Get all non-deleted items
  const { results: items } = await env.DB.prepare(
    `SELECT id, text, completed, updated_at as updatedAt 
     FROM items 
     WHERE list_id = ? AND deleted = FALSE 
     ORDER BY created_at DESC`
  ).bind(listId).all();

  return json({ 
    id: list.id, 
    name: list.name,
    items: items || [] 
  }, corsHeaders);
}

async function syncChanges(listId, pin, request, env, corsHeaders) {
  // Verify credentials
  const list = await env.DB.prepare(
    'SELECT * FROM lists WHERE id = ? AND pin = ?'
  ).bind(listId, pin).first();

  if (!list) {
    return error('Invalid credentials', 401, corsHeaders);
  }

  const { changes, lastSync } = await request.json();

  // Apply incoming changes
  if (changes && changes.length > 0) {
    for (const change of changes) {
      if (change.type === 'add') {
        await env.DB.prepare(
          `INSERT INTO items (id, list_id, text, completed, updated_at) 
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           completed = excluded.completed,
           updated_at = excluded.updated_at`
        ).bind(
          change.id, 
          listId, 
          change.text, 
          change.completed,
          change.timestamp
        ).run();
      } else if (change.type === 'update') {
        await env.DB.prepare(
          `UPDATE items SET 
           completed = ?,
           text = ?,
           updated_at = ?
           WHERE id = ? AND list_id = ?`
        ).bind(change.completed, change.text, change.timestamp, change.id, listId).run();
      } else if (change.type === 'delete') {
        await env.DB.prepare(
          `UPDATE items SET deleted = TRUE, updated_at = ? WHERE id = ? AND list_id = ?`
        ).bind(change.timestamp, change.id, listId).run();
      }
    }
  }

  // Return changes since lastSync
  const { results: serverChanges } = await env.DB.prepare(
    `SELECT id, text, completed, updated_at as timestamp, deleted
     FROM items 
     WHERE list_id = ? AND updated_at > ?`
  ).bind(listId, lastSync || '1970-01-01').all();

  return json({ 
    changes: (serverChanges || []).map(c => ({
      ...c,
      type: c.deleted ? 'delete' : 'update'
    })),
    timestamp: new Date().toISOString()
  }, corsHeaders);
}

async function addItem(listId, pin, request, env, corsHeaders) {
  const list = await env.DB.prepare(
    'SELECT * FROM lists WHERE id = ? AND pin = ?'
  ).bind(listId, pin).first();

  if (!list) {
    return error('Invalid credentials', 401, corsHeaders);
  }

  const body = await request.json();
  const id = generateId();
  const timestamp = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO items (id, list_id, text, completed, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, listId, body.text, false, timestamp).run();

  return json({ id, text: body.text, completed: false, timestamp }, corsHeaders);
}

async function deleteItem(listId, pin, itemId, env, corsHeaders) {
  const list = await env.DB.prepare(
    'SELECT * FROM lists WHERE id = ? AND pin = ?'
  ).bind(listId, pin).first();

  if (!list) {
    return error('Invalid credentials', 401, corsHeaders);
  }

  await env.DB.prepare(
    'UPDATE items SET deleted = TRUE, updated_at = ? WHERE id = ? AND list_id = ?'
  ).bind(new Date().toISOString(), itemId, listId).run();

  return json({ success: true }, corsHeaders);
}

function json(data, headers, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function error(message, status, headers) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}