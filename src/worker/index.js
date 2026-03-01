// Cloudflare Worker - Shopping List API with Google OAuth
// Private-by-default with sharing

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Handle OAuth callback before static assets (needs to return HTML)
      if (url.pathname === '/auth/callback') {
        return handleAuthCallback(request, env, corsHeaders);
      }
      
      // Serve static assets for non-API routes
      if (!url.pathname.startsWith('/api/')) {
        return env.ASSETS.fetch(request);
      }

      // Auth routes (no auth required)
      if (url.pathname === '/api/auth/google') {
        return getGoogleAuthUrl(env, corsHeaders);
      }
      
      if (url.pathname === '/api/auth/callback') {
        return handleGoogleCallback(request, env, corsHeaders);
      }
      
      if (url.pathname === '/api/auth/logout') {
        return logout(request, env, corsHeaders);
      }

      // User routes
      if (url.pathname === '/api/user') {
        return getUser(request, env, corsHeaders);
      }

      // All other routes require authentication
      const auth = await authenticateRequest(request, env);
      if (!auth.success) {
        return error(auth.error, 401, corsHeaders);
      }
      const user = auth.user;

      // List routes
      if (url.pathname === '/api/lists' && request.method === 'GET') {
        return getUserLists(user, env, corsHeaders);
      }
      
      if (url.pathname === '/api/list' && request.method === 'POST') {
        return createList(request, user, env, corsHeaders);
      }

      // Get list by ID - must be owner or collaborator
      if (url.pathname.match(/^\/api\/list\/[\w-]+$/) && request.method === 'GET') {
        const listId = url.pathname.split('/')[3];
        return getList(listId, user, env, corsHeaders);
      }

      // Share list
      if (url.pathname.match(/^\/api\/list\/[\w-]+\/share$/) && request.method === 'POST') {
        const listId = url.pathname.split('/')[3];
        return shareList(listId, request, user, env, corsHeaders);
      }

      // Get shares for a list
      if (url.pathname.match(/^\/api\/list\/[\w-]+\/shares$/) && request.method === 'GET') {
        const listId = url.pathname.split('/')[3];
        return getListShares(listId, user, env, corsHeaders);
      }

      // Remove share
      if (url.pathname.match(/^\/api\/list\/[\w-]+\/share\/[\w-]+$/) && request.method === 'DELETE') {
        const parts = url.pathname.split('/');
        const listId = parts[3];
        const shareUserId = parts[5];
        return removeShare(listId, shareUserId, user, env, corsHeaders);
      }

      // Category routes
      if (url.pathname.match(/^\/api\/list\/[\w-]+\/categories$/) && request.method === 'GET') {
        const listId = url.pathname.split('/')[3];
        return getCategories(listId, user, env, corsHeaders);
      }
      
      if (url.pathname.match(/^\/api\/list\/[\w-]+\/categories$/) && request.method === 'POST') {
        const listId = url.pathname.split('/')[3];
        return createCategory(listId, request, user, env, corsHeaders);
      }

      if (url.pathname.match(/^\/api\/list\/[\w-]+\/categories\/order$/) && request.method === 'PUT') {
        const listId = url.pathname.split('/')[3];
        return updateCategoryOrder(listId, request, user, env, corsHeaders);
      }

      if (url.pathname.match(/^\/api\/list\/[\w-]+\/categories\/[\w-]+$/) && request.method === 'DELETE') {
        const parts = url.pathname.split('/');
        const listId = parts[3];
        const categoryId = parts[5];
        return deleteCategory(listId, categoryId, user, env, corsHeaders);
      }

      // Sync route
      if (url.pathname.match(/^\/api\/list\/[\w-]+\/sync$/) && request.method === 'POST') {
        const listId = url.pathname.split('/')[3];
        return syncChanges(listId, request, user, env, corsHeaders);
      }

      // Items routes
      if (url.pathname.match(/^\/api\/list\/[\w-]+\/items$/) && request.method === 'POST') {
        const listId = url.pathname.split('/')[3];
        return addItem(listId, request, user, env, corsHeaders);
      }

      if (url.pathname.match(/^\/api\/list\/[\w-]+\/items\/[\w-]+$/) && request.method === 'DELETE') {
        const parts = url.pathname.split('/');
        const listId = parts[3];
        const itemId = parts[5];
        return deleteItem(listId, itemId, user, env, corsHeaders);
      }

      return json({ error: 'Not found', path: url.pathname, method: request.method }, corsHeaders, 404);
    } catch (err) {
      console.error('Error:', err);
      return error(err.message, 500, corsHeaders);
    }
  }
};

// Auth Functions

function getGoogleAuthUrl(env, corsHeaders) {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  
  // Client will replace REPLACE_WITH_ORIGIN with actual origin
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent('REPLACE_WITH_ORIGIN')}` +
    `&response_type=token` +
    `&scope=${encodeURIComponent('https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile')}` +
    `&state=${generateId()}`;
  
  return json({ authUrl }, corsHeaders);
}

async function handleAuthCallback(request, env, corsHeaders) {
  // For redirect OAuth flow - serve HTML that processes the token and redirects back to app
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Signing in...</title>
</head>
<body>
  <p>Signing in...</p>
  <script>
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const expiresIn = params.get('expires_in');
    
    if (accessToken) {
      // Store token in localStorage
      localStorage.setItem('authToken', accessToken);
      localStorage.setItem('tokenExpiry', (Date.now() + (expiresIn * 1000)).toString());
      
      // Get user info and store
      fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': 'Bearer ' + accessToken }
      })
      .then(res => res.json())
      .then(userInfo => {
        localStorage.setItem('authUser', JSON.stringify(userInfo));
        // Redirect back to app
        window.location.href = '/';
      })
      .catch(err => {
        // Still redirect, we'll re-auth on app load
        window.location.href = '/';
      });
    } else {
      // No token, redirect to app (will show login)
      window.location.href = '/';
    }
  </script>
</body>
</html>`;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

async function handleGoogleCallback(request, env, corsHeaders) {
  const url = new URL(request.url);
  const hash = url.hash.substring(1); // Remove # 
  
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const expiresIn = params.get('expires_in');
  const state = params.get('state');
  
  if (!accessToken) {
    return error('No access token received', 400, corsHeaders);
  }
  
  // Get user info from Google
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  
  if (!userInfoRes.ok) {
    return error('Failed to get user info from Google', 400, corsHeaders);
  }
  
  const userInfo = await userInfoRes.json();
  
  // Upsert user in database
  const existingUser = await env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(userInfo.id).first();
  
  if (!existingUser) {
    await env.DB.prepare(
      'INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?)'
    ).bind(userInfo.id, userInfo.email, userInfo.name, userInfo.picture).run();
  } else {
    // Update in case profile changed
    await env.DB.prepare(
      'UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?'
    ).bind(userInfo.email, userInfo.name, userInfo.picture, userInfo.id).run();
  }
  
  // Return user info (in production, you'd issue a proper JWT or session)
  return json({
    user: {
      id: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture
    },
    accessToken, // In production, issue your own token
    expiresIn
  }, corsHeaders);
}

async function logout(request, env, corsHeaders) {
  // In a full implementation, you'd invalidate the token server-side
  return json({ success: true }, corsHeaders);
}

async function getUser(request, env, corsHeaders) {
  const auth = await authenticateRequest(request, env);
  if (!auth.success) {
    return error(auth.error, 401, corsHeaders);
  }
  
  return json({ user: auth.user }, corsHeaders);
}

async function authenticateRequest(request, env) {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { success: false, error: 'Missing authorization' };
  }
  
  const token = authHeader.substring(7);
  
  try {
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!userInfoRes.ok) {
      return { success: false, error: 'Invalid token' };
    }
    
    const userInfo = await userInfoRes.json();
    
    // Ensure user exists in our DB
    const user = await env.DB.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).bind(userInfo.id).first();
    
    if (!user) {
      // Create user on the fly
      await env.DB.prepare(
        'INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?)'
      ).bind(userInfo.id, userInfo.email, userInfo.name, userInfo.picture).run();
      
      return {
        success: true,
        user: {
          id: userInfo.id,
          email: userInfo.email,
          name: userInfo.name,
          picture: userInfo.picture
        }
      };
    }
    
    return {
      success: true,
      user: {
        id: userInfo.id,
        email: user.email,
        name: user.name,
        picture: user.picture
      }
    };
  } catch (e) {
    return { success: false, error: 'Authentication failed' };
  }
}

async function checkListAccess(listId, userId, env) {
  // Check if user is owner
  const list = await env.DB.prepare(
    'SELECT * FROM lists WHERE id = ?'
  ).bind(listId).first();
  
  if (!list) {
    return { access: false, error: 'List not found: ' + listId };
  }
  
  if (list.owner_id === userId) {
    return { access: true, list, role: 'owner' };
  }
  
  // Check if user is collaborator
  const share = await env.DB.prepare(
    'SELECT * FROM list_shares WHERE list_id = ? AND user_id = ?'
  ).bind(listId, userId).first();
  
  if (share) {
    return { access: true, list, role: share.role };
  }
  
  return { access: false, error: 'Access denied for user: ' + userId };
}

// List Functions

async function getUserLists(user, env, corsHeaders) {
  // Get lists owned by user
  const ownedLists = await env.DB.prepare(
    'SELECT id, name, owner_id as ownerId, created_at as createdAt, updated_at as updatedAt FROM lists WHERE owner_id = ? AND deleted = FALSE ORDER BY updated_at DESC'
  ).bind(user.id).all();
  
  // Get lists shared with user
  const sharedLists = await env.DB.prepare(
    'SELECT l.id, l.name, l.owner_id as ownerId, l.created_at as createdAt, l.updated_at as updatedAt, ls.role FROM lists l JOIN list_shares ls ON l.id = ls.list_id WHERE ls.user_id = ? AND l.deleted = FALSE ORDER BY l.updated_at DESC'
  ).bind(user.id).all();
  
  // Combine and mark ownership
  const lists = [
    ...(ownedLists.results || []).map(l => ({ ...l, access: 'owner' })),
    ...(sharedLists.results || []).map(l => ({ ...l, access: l.role }))
  ];
  
  return json({ lists }, corsHeaders);
}

async function createList(request, user, env, corsHeaders) {
  const body = await request.json();
  const { name } = body;
  
  if (!name) {
    return error('List name required', 400, corsHeaders);
  }
  
  const id = generateId();
  
  await env.DB.prepare(
    'INSERT INTO lists (id, name, owner_id) VALUES (?, ?, ?)'
  ).bind(id, name, user.id).run();
  
  // Create default "Uncategorized" category
  const defaultCategoryId = generateId();
  await env.DB.prepare(
    'INSERT INTO categories (id, list_id, name, sort_order) VALUES (?, ?, ?, ?)'
  ).bind(defaultCategoryId, id, 'Uncategorized', 0).run();
  
  return json({ 
    id, 
    name, 
    defaultCategoryId,
    access: 'owner'
  }, corsHeaders);
}

async function getList(listId, user, env, corsHeaders) {
  const access = await checkListAccess(listId, user.id, env);
  
  if (!access.access) {
    return error(access.error, 403, corsHeaders);
  }
  
  const list = access.list;
  
  // Get items
  const itemsResult = await env.DB.prepare(
    `SELECT i.id, i.text, i.completed, i.category_id as categoryId, 
            c.name as categoryName, i.updated_at as updatedAt 
     FROM items i
     LEFT JOIN categories c ON i.category_id = c.id
     WHERE i.list_id = ? AND i.deleted = FALSE 
     ORDER BY i.created_at DESC`
  ).bind(listId).all();
  
  // Get categories
  const categoriesResult = await env.DB.prepare(
    `SELECT id, name, sort_order as sortOrder
     FROM categories
     WHERE list_id = ? AND deleted = FALSE
     ORDER BY sort_order ASC, name ASC`
  ).bind(listId).all();
  
  return json({ 
    id: list.id, 
    name: list.name,
    access: access.role,
    items: itemsResult.results || [],
    categories: categoriesResult.results || []
  }, corsHeaders);
}

async function shareList(listId, request, user, env, corsHeaders) {
  const access = await checkListAccess(listId, user.id, env);
  
  if (!access.access) {
    return error(access.error, 403, corsHeaders);
  }
  
  if (access.role !== 'owner') {
    return error('Only owner can share list', 403, corsHeaders);
  }
  
  const { email } = await request.json();
  
  if (!email) {
    return error('Email required', 400, corsHeaders);
  }
  
  // Find user by email
  const targetUser = await env.DB.prepare(
    'SELECT id, email, name, picture FROM users WHERE email = ?'
  ).bind(email).first();
  
  if (!targetUser) {
    return error('User not found. They must sign in first.', 404, corsHeaders);
  }
  
  if (targetUser.id === user.id) {
    return error('Cannot share with yourself', 400, corsHeaders);
  }
  
  // Check if already shared
  const existingShare = await env.DB.prepare(
    'SELECT * FROM list_shares WHERE list_id = ? AND user_id = ?'
  ).bind(listId, targetUser.id).first();
  
  if (existingShare) {
    return error('List already shared with this user', 400, corsHeaders);
  }
  
  // Add share
  await env.DB.prepare(
    'INSERT INTO list_shares (list_id, user_id, role) VALUES (?, ?, ?)'
  ).bind(listId, targetUser.id, 'collaborator').run();
  
  return json({ 
    success: true, 
    sharedWith: {
      id: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      picture: targetUser.picture
    }
  }, corsHeaders);
}

async function getListShares(listId, user, env, corsHeaders) {
  const access = await checkListAccess(listId, user.id, env);
  
  if (!access.access) {
    return error(access.error, 403, corsHeaders);
  }
  
  const shares = await env.DB.prepare(
    `SELECT ls.user_id as id, u.email, u.name, u.picture, ls.role, ls.created_at as createdAt
     FROM list_shares ls
     JOIN users u ON ls.user_id = u.id
     WHERE ls.list_id = ?`
  ).bind(listId).all();
  
  return json({ shares: shares.results || [] }, corsHeaders);
}

async function removeShare(listId, shareUserId, user, env, corsHeaders) {
  const access = await checkListAccess(listId, user.id, env);
  
  if (!access.access) {
    return error(access.error, 403, corsHeaders);
  }
  
  if (access.role !== 'owner') {
    return error('Only owner can remove shares', 403, corsHeaders);
  }
  
  await env.DB.prepare(
    'DELETE FROM list_shares WHERE list_id = ? AND user_id = ?'
  ).bind(listId, shareUserId).run();
  
  return json({ success: true }, corsHeaders);
}

// Category Functions

async function getCategories(listId, user, env, corsHeaders) {
  const access = await checkListAccess(listId, user.id, env);
  
  if (!access.access) {
    return error(access.error, 403, corsHeaders);
  }
  
  const { results: categories } = await env.DB.prepare(
    `SELECT id, name, sort_order as sortOrder, updated_at as updatedAt
     FROM categories
     WHERE list_id = ? AND deleted = FALSE
     ORDER BY sort_order ASC, name ASC`
  ).bind(listId).all();
  
  return json({ categories: categories || [] }, corsHeaders);
}

async function createCategory(listId, request, user, env, corsHeaders) {
  const access = await checkListAccess(listId, user.id, env);
  
  if (!access.access) {
    return error(access.error, 403, corsHeaders);
  }
  
  const body = await request.json();
  const { name } = body;
  
  if (!name) {
    return error('Category name required', 400, corsHeaders);
  }
  
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

async function updateCategoryOrder(listId, request, user, env, corsHeaders) {
  const access = await checkListAccess(listId, user.id, env);
  
  if (!access.access) {
    return error(access.error, 403, corsHeaders);
  }
  
  const { order } = await request.json();
  const timestamp = new Date().toISOString();
  
  for (let i = 0; i < order.length; i++) {
    await env.DB.prepare(
      'UPDATE categories SET sort_order = ?, updated_at = ? WHERE id = ? AND list_id = ?'
    ).bind(i, timestamp, order[i], listId).run();
  }
  
  return json({ success: true, timestamp }, corsHeaders);
}

async function deleteCategory(listId, categoryId, user, env, corsHeaders) {
  const access = await checkListAccess(listId, user.id, env);
  
  if (!access.access) {
    return error(access.error, 403, corsHeaders);
  }
  
  const timestamp = new Date().toISOString();
  
  await env.DB.prepare(
    'UPDATE categories SET deleted = TRUE, updated_at = ? WHERE id = ? AND list_id = ?'
  ).bind(timestamp, categoryId, listId).run();
  
  await env.DB.prepare(
    'UPDATE items SET category_id = NULL, updated_at = ? WHERE category_id = ? AND list_id = ?'
  ).bind(timestamp, categoryId, listId).run();
  
  return json({ success: true }, corsHeaders);
}

// Sync Functions

async function syncChanges(listId, request, user, env, corsHeaders) {
  const access = await checkListAccess(listId, user.id, env);
  
  if (!access.access) {
    return error(access.error, 403, corsHeaders);
  }
  
  const body = await request.json();
  const { itemChanges, categoryChanges, categoryOrder, lastSync } = body;
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
            'UPDATE categories SET deleted = TRUE, updated_at = ? WHERE id = ? AND list_id = ?'
          ).bind(serverTimestamp, change.id, listId).run();
        }
      } catch (e) {
        console.error('Category change failed:', e);
      }
    }
  }
  
  // Apply category order
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
  
  // Apply item changes
  if (itemChanges && itemChanges.length > 0) {
    for (const change of itemChanges) {
      try {
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
            'UPDATE items SET deleted = TRUE, updated_at = ? WHERE id = ? AND list_id = ?'
          ).bind(serverTimestamp, change.id, listId).run();
        }
      } catch (e) {
        console.error('Item change failed:', e);
      }
    }
  }
  
  // Return changes since lastSync
  const serverItemChanges = await env.DB.prepare(
    `SELECT id, category_id as categoryId, text, completed, updated_at as timestamp, deleted
     FROM items 
     WHERE list_id = ? AND updated_at > ?`
  ).bind(listId, lastSync || '1970-01-01').all();
  
  const serverCategoryChanges = await env.DB.prepare(
    `SELECT id, name, sort_order as sortOrder, updated_at as timestamp, deleted
     FROM categories 
     WHERE list_id = ? AND updated_at > ?`
  ).bind(listId, lastSync || '1970-01-01').all();
  
  const currentOrder = await env.DB.prepare(
    `SELECT id FROM categories 
     WHERE list_id = ? AND deleted = FALSE
     ORDER BY sort_order ASC`
  ).bind(listId).all();
  
  return json({ 
    itemChanges: (serverItemChanges.results || []).map(c => ({
      ...c,
      type: c.deleted ? 'delete' : 'update'
    })),
    categoryChanges: (serverCategoryChanges.results || []).map(c => ({
      ...c,
      type: c.deleted ? 'delete' : 'update',
      sortOrder: c.sortOrder
    })),
    categoryOrder: (currentOrder.results || []).map(c => c.id),
    timestamp: serverTimestamp
  }, corsHeaders);
}

// Item Functions

async function addItem(listId, request, user, env, corsHeaders) {
  const access = await checkListAccess(listId, user.id, env);
  
  if (!access.access) {
    return error(access.error, 403, corsHeaders);
  }
  
  const body = await request.json();
  const id = generateId();
  const timestamp = new Date().toISOString();
  
  await env.DB.prepare(
    'INSERT INTO items (id, list_id, category_id, text, completed, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, listId, body.categoryId || null, body.text, false, timestamp).run();
  
  return json({ id, text: body.text, categoryId: body.categoryId, completed: false, timestamp }, corsHeaders);
}

async function deleteItem(listId, itemId, user, env, corsHeaders) {
  const access = await checkListAccess(listId, user.id, env);
  
  if (!access.access) {
    return error(access.error, 403, corsHeaders);
  }
  
  await env.DB.prepare(
    'UPDATE items SET deleted = TRUE, updated_at = ? WHERE id = ? AND list_id = ?'
  ).bind(new Date().toISOString(), itemId, listId).run();
  
  return json({ success: true }, corsHeaders);
}

// Helpers

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
