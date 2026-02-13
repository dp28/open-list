// Cloudflare Worker - Shopping List API with Categories
// Minimal, dependency-free sync server

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
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
        return env.ASSETS.fetch(request);
      }

      // Extract list ID and PIN from headers
      const listId = request.headers.get('X-List-ID');
      const pin = request.headers.get('X-List-PIN');

      // Routes
      if (url.pathname === '/api/list' && request.method === 'POST') {
        return createList(request, env, corsHeaders);
      }
      
      if (url.pathname === '/api/list' && request.method === 'GET') {
        if (!listId || !pin) return error('Missing credentials', 401, corsHeaders);
        return getList(listId, pin, env, corsHeaders);
      }

      // Category routes
      if (url.pathname === '/api/categories' && request.method === 'GET') {
        if (!listId || !pin) return error('Missing credentials', 401, corsHeaders);
        return getCategories(listId, pin, env, corsHeaders);
      }
      
      if (url.pathname === '/api/categories' && request.method === 'POST') {
        if (!listId || !pin) return error('Missing credentials', 401, corsHeaders);
        return createCategory(listId, pin, request, env, corsHeaders);
      }
      
      if (url.pathname === '/api/categories/order' && request.method === 'PUT') {
        if (!listId || !pin) return error('Missing credentials', 401, corsHeaders);
        return updateCategoryOrder(listId, pin, request, env, corsHeaders);
      }

      if (url.pathname.startsWith('/api/categories/') && request.method === 'DELETE') {
        if (!listId || !pin) return error('Missing credentials', 401, corsHeaders);
        const categoryId = url.pathname.split('/').pop();
        return deleteCategory(listId, pin, categoryId, env, corsHeaders);
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

  // Create default "Uncategorized" category
  const defaultCategoryId = generateId();
  await env.DB.prepare(
    'INSERT INTO categories (id, list_id, name, sort_order) VALUES (?, ?, ?, ?)'
  ).bind(defaultCategoryId, id, 'Uncategorized', 0).run();

  return json({ id, name, defaultCategoryId }, corsHeaders);
}

async function getList(listId, pin, env, corsHeaders) {
  // Verify credentials
  const list = await env.DB.prepare(
    'SELECT * FROM lists WHERE id = ? AND pin = ?'
  ).bind(listId, pin).first();

  if (!list) {
    return error('Invalid credentials', 401, corsHeaders);
  }

  // Check if category_id column exists
  let items;
  try {
    // Try to get items with category info
    const result = await env.DB.prepare(
      `SELECT i.id, i.text, i.completed, i.category_id as categoryId, 
              c.name as categoryName, i.updated_at as updatedAt 
       FROM items i
       LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.list_id = ? AND i.deleted = FALSE 
       ORDER BY i.created_at DESC`
    ).bind(listId).all();
    items = result.results;
  } catch (e) {
    // Fallback: get items without category (column doesn't exist yet)
    const result = await env.DB.prepare(
      `SELECT id, text, completed, NULL as categoryId, 
              NULL as categoryName, updated_at as updatedAt 
       FROM items
       WHERE list_id = ? AND deleted = FALSE 
       ORDER BY created_at DESC`
    ).bind(listId).all();
    items = result.results;
  }

  // Get categories
  let categories = [];
  try {
    const result = await env.DB.prepare(
      `SELECT id, name, sort_order as sortOrder
       FROM categories
       WHERE list_id = ? AND deleted = FALSE
       ORDER BY sort_order ASC, name ASC`
    ).bind(listId).all();
    categories = result.results || [];
  } catch (e) {
    // Categories table might not exist yet
    categories = [];
  }

  return json({ 
    id: list.id, 
    name: list.name,
    items: items || [],
    categories: categories || []
  }, corsHeaders);
}

async function getCategories(listId, pin, env, corsHeaders) {
  const list = await env.DB.prepare(
    'SELECT * FROM lists WHERE id = ? AND pin = ?'
  ).bind(listId, pin).first();

  if (!list) {
    return error('Invalid credentials', 401, corsHeaders);
  }

  const { results: categories } = await env.DB.prepare(
    `SELECT id, name, sort_order as sortOrder, updated_at as updatedAt
     FROM categories
     WHERE list_id = ? AND deleted = FALSE
     ORDER BY sort_order ASC, name ASC`
  ).bind(listId).all();

  return json({ categories: categories || [] }, corsHeaders);
}

async function createCategory(listId, pin, request, env, corsHeaders) {
  const list = await env.DB.prepare(
    'SELECT * FROM lists WHERE id = ? AND pin = ?'
  ).bind(listId, pin).first();

  if (!list) {
    return error('Invalid credentials', 401, corsHeaders);
  }

  const body = await request.json();
  const { name } = body;
  
  if (!name) {
    return error('Category name required', 400, corsHeaders);
  }

  // Get max sort order
  const { results } = await env.DB.prepare(
    'SELECT MAX(sort_order) as maxOrder FROM categories WHERE list_id = ?'
  ).bind(listId).all();
  const sortOrder = (results[0]?.maxOrder || 0) + 1;

  const id = generateId();
  const timestamp = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO categories (id, list_id, name, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, listId, name, sortOrder, timestamp).run();

  return json({ id, name, sortOrder, timestamp }, corsHeaders);
}

async function updateCategoryOrder(listId, pin, request, env, corsHeaders) {
  const list = await env.DB.prepare(
    'SELECT * FROM lists WHERE id = ? AND pin = ?'
  ).bind(listId, pin).first();

  if (!list) {
    return error('Invalid credentials', 401, corsHeaders);
  }

  const { order } = await request.json();
  const timestamp = new Date().toISOString();

  // Update sort_order for each category
  for (let i = 0; i < order.length; i++) {
    await env.DB.prepare(
      'UPDATE categories SET sort_order = ?, updated_at = ? WHERE id = ? AND list_id = ?'
    ).bind(i, timestamp, order[i], listId).run();
  }

  return json({ success: true, timestamp }, corsHeaders);
}

async function deleteCategory(listId, pin, categoryId, env, corsHeaders) {
  const list = await env.DB.prepare(
    'SELECT * FROM lists WHERE id = ? AND pin = ?'
  ).bind(listId, pin).first();

  if (!list) {
    return error('Invalid credentials', 401, corsHeaders);
  }

  const timestamp = new Date().toISOString();

  // Soft delete category
  await env.DB.prepare(
    'UPDATE categories SET deleted = TRUE, updated_at = ? WHERE id = ? AND list_id = ?'
  ).bind(timestamp, categoryId, listId).run();

  // Set items in this category to null
  try {
    await env.DB.prepare(
      'UPDATE items SET category_id = NULL, updated_at = ? WHERE category_id = ? AND list_id = ?'
    ).bind(timestamp, categoryId, listId).run();
  } catch (e) {
    // Column might not exist yet
  }

  return json({ success: true }, corsHeaders);
}

async function syncChanges(listId, pin, request, env, corsHeaders) {
  const list = await env.DB.prepare(
    'SELECT * FROM lists WHERE id = ? AND pin = ?'
  ).bind(listId, pin).first();

  if (!list) {
    return error('Invalid credentials', 401, corsHeaders);
  }

  const { itemChanges, categoryChanges, categoryOrder, lastSync } = await request.json();
  const serverTimestamp = new Date().toISOString();

  // Apply category changes
  if (categoryChanges && categoryChanges.length > 0) {
    for (const change of categoryChanges) {
      try {
        if (change.type === 'add') {
          await env.DB.prepare(
            `INSERT INTO categories (id, list_id, name, sort_order, updated_at) 
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             sort_order = excluded.sort_order,
             updated_at = excluded.updated_at`
          ).bind(change.id, listId, change.name, change.sortOrder || 0, serverTimestamp).run();
        } else if (change.type === 'update') {
          await env.DB.prepare(
            `UPDATE categories SET 
             name = ?,
             sort_order = ?,
             updated_at = ?
             WHERE id = ? AND list_id = ?`
          ).bind(change.name, change.sortOrder, serverTimestamp, change.id, listId).run();
        } else if (change.type === 'delete') {
          await env.DB.prepare(
            `UPDATE categories SET deleted = TRUE, updated_at = ? WHERE id = ? AND list_id = ?`
          ).bind(serverTimestamp, change.id, listId).run();
        }
      } catch (e) {
        console.error('Category change failed:', e);
      }
    }
  }

  // Apply category order if provided
  if (categoryOrder && categoryOrder.length > 0) {
    for (let i = 0; i < categoryOrder.length; i++) {
      try {
        await env.DB.prepare(
          'UPDATE categories SET sort_order = ?, updated_at = ? WHERE id = ? AND list_id = ?'
        ).bind(i, serverTimestamp, categoryOrder[i], listId).run();
      } catch (e) {
        console.error('Category order update failed:', e);
      }
    }
  }

  // Check if category_id column exists
  let hasCategoryColumn = true;
  try {
    await env.DB.prepare("SELECT category_id FROM items LIMIT 1").first();
  } catch (e) {
    hasCategoryColumn = false;
  }

  // Apply item changes
  if (itemChanges && itemChanges.length > 0) {
    for (const change of itemChanges) {
      try {
        if (hasCategoryColumn) {
          if (change.type === 'add') {
            await env.DB.prepare(
              `INSERT INTO items (id, list_id, category_id, text, completed, updated_at) 
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
               category_id = excluded.category_id,
               text = excluded.text,
               completed = excluded.completed,
               updated_at = excluded.updated_at`
            ).bind(
              change.id, 
              listId, 
              change.categoryId,
              change.text, 
              change.completed,
              serverTimestamp
            ).run();
          } else if (change.type === 'update') {
            await env.DB.prepare(
              `UPDATE items SET 
               category_id = ?,
               completed = ?,
               text = ?,
               updated_at = ?
               WHERE id = ? AND list_id = ?`
            ).bind(change.categoryId || null, change.completed, change.text, serverTimestamp, change.id, listId).run();
          } else if (change.type === 'delete') {
            await env.DB.prepare(
              `UPDATE items SET deleted = TRUE, updated_at = ? WHERE id = ? AND list_id = ?`
            ).bind(serverTimestamp, change.id, listId).run();
          }
        } else {
          // Fallback without category_id
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
              serverTimestamp
            ).run();
          } else if (change.type === 'update') {
            await env.DB.prepare(
              `UPDATE items SET 
               completed = ?,
               text = ?,
               updated_at = ?
               WHERE id = ? AND list_id = ?`
            ).bind(change.completed, change.text, serverTimestamp, change.id, listId).run();
          } else if (change.type === 'delete') {
            await env.DB.prepare(
              `UPDATE items SET deleted = TRUE, updated_at = ? WHERE id = ? AND list_id = ?`
            ).bind(serverTimestamp, change.id, listId).run();
          }
        }
      } catch (e) {
        console.error('Item change failed:', e);
      }
    }
  }

  // Return changes since lastSync
  let serverItemChanges = [];
  try {
    const result = await env.DB.prepare(
      `SELECT id, category_id as categoryId, text, completed, updated_at as timestamp, deleted
       FROM items 
       WHERE list_id = ? AND updated_at > ?`
    ).bind(listId, lastSync || '1970-01-01').all();
    serverItemChanges = result.results || [];
  } catch (e) {
    // Fallback without category_id
    const result = await env.DB.prepare(
      `SELECT id, NULL as categoryId, text, completed, updated_at as timestamp, deleted
       FROM items 
       WHERE list_id = ? AND updated_at > ?`
    ).bind(listId, lastSync || '1970-01-01').all();
    serverItemChanges = result.results || [];
  }

  let serverCategoryChanges = [];
  let currentOrder = [];
  
  try {
    const result = await env.DB.prepare(
      `SELECT id, name, sort_order as sortOrder, updated_at as timestamp, deleted
       FROM categories 
       WHERE list_id = ? AND updated_at > ?`
    ).bind(listId, lastSync || '1970-01-01').all();
    serverCategoryChanges = result.results || [];
    
    const orderResult = await env.DB.prepare(
      `SELECT id FROM categories 
       WHERE list_id = ? AND deleted = FALSE
       ORDER BY sort_order ASC`
    ).bind(listId).all();
    currentOrder = orderResult.results || [];
  } catch (e) {
    // Categories table doesn't exist yet
  }

  return json({ 
    itemChanges: (serverItemChanges || []).map(c => ({
      ...c,
      type: c.deleted ? 'delete' : 'update'
    })),
    categoryChanges: (serverCategoryChanges || []).map(c => ({
      ...c,
      type: c.deleted ? 'delete' : 'update'
    })),
    categoryOrder: (currentOrder || []).map(c => c.id),
    timestamp: serverTimestamp
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

  // Check if category_id column exists by attempting to describe the table
  let hasCategoryColumn = true;
  try {
    await env.DB.prepare("SELECT category_id FROM items LIMIT 1").first();
  } catch (e) {
    hasCategoryColumn = false;
  }

  if (hasCategoryColumn) {
    await env.DB.prepare(
      'INSERT INTO items (id, list_id, category_id, text, completed, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, listId, body.categoryId || null, body.text, false, timestamp).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO items (id, list_id, text, completed, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, listId, body.text, false, timestamp).run();
  }

  return json({ id, text: body.text, categoryId: body.categoryId, completed: false, timestamp }, corsHeaders);
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