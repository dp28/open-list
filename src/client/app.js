// Main app logic - PWA shopping list with Google OAuth
// Private-by-default with sharing

const API_URL = window.location.origin;
const localDB = new LocalDB();

let currentUser = null;
let currentList = null;
let savedLists = [];
let syncInterval = null;
let categories = [];
let draggedCategory = null;
let sortableInstance = null;

// Initialize
async function init() {
  await localDB.init();
  await initTheme();
  
  // Check for OAuth callback - token stored in localStorage by callback page
  const storedToken = localStorage.getItem('authToken');
  const storedUser = localStorage.getItem('authUser');
  const tokenExpiry = localStorage.getItem('tokenExpiry');
  
  // Clear from localStorage after reading
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUser');
  localStorage.removeItem('tokenExpiry');
  
  let token = storedToken;
  let user = storedUser ? JSON.parse(storedUser) : null;
  
  // Check if token is expired
  if (token && tokenExpiry && parseInt(tokenExpiry) < Date.now()) {
    token = null;
    user = null;
  }
  
  if (!token || !user) {
    // Try IndexedDB as fallback
    user = await localDB.getAuthUser();
    token = await localDB.getAuthToken();
  }
  
  if (!user || !token) {
    // Show login screen
    showLoginScreen();
    return;
  }
  
  // Verify token with backend
  try {
    const response = await fetch(`${API_URL}/api/user`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
      // Token invalid, show login
      showLoginScreen();
      return;
    }
    
    const data = await response.json();
    currentUser = data.user;
    await localDB.saveAuth(currentUser, token);
  } catch (e) {
    showLoginScreen();
    return;
  }
  
  // Load user's lists
  await loadSavedLists();
  
  // Check for URL parameters (shared list link)
  const urlParams = new URLSearchParams(window.location.search);
  const sharedListId = urlParams.get('list');
  
  if (sharedListId) {
    // Try to access the shared list
    try {
      await openList(sharedListId);
    } catch (e) {
      alert('Cannot access list. You may not have permission.');
    }
  } else if (savedLists.length > 0) {
    // Load the most recently used list
    const lastUsedList = await localDB.getMeta('lastUsedListId');
    const listToLoad = savedLists.find(l => l.id === lastUsedList) || savedLists[0];
    await switchToList(listToLoad);
  } else {
    // Show empty state or create first list
    showCreateFirstListPrompt();
  }
  
  // Listen for online/offline
  window.addEventListener('online', () => {
    showSyncStatus('Back online', false);
    syncNow();
  });
  window.addEventListener('offline', () => {
    showSyncStatus('Offline mode', true);
  });
  
  registerServiceWorker();
  setupPwaInstall();
  setupCategoryInput();
  
  const isCollapsed = await localDB.getMeta('addSectionCollapsed');
  if (isCollapsed) {
    toggleAddSection(true);
  }
}

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
}

function hideLoginScreen() {
  document.getElementById('login-screen').classList.add('hidden');
}

function showCreateFirstListPrompt() {
  document.getElementById('no-lists-screen').classList.remove('hidden');
}

function hideCreateFirstListPrompt() {
  document.getElementById('no-lists-screen').classList.add('hidden');
}

async function signInWithGoogle() {
  try {
    // Get auth URL template from backend
    const response = await fetch(`${API_URL}/api/auth/google`);
    const { authUrl } = await response.json();
    
    // Replace placeholder with actual origin
    const actualAuthUrl = authUrl.replace('REPLACE_WITH_ORIGIN', `${window.location.origin}/auth/callback`);
    
    // Redirect to Google for authentication
    window.location.href = actualAuthUrl;
  } catch (err) {
    console.error('Sign in error:', err);
    alert('Sign in failed. Please try again.');
  }
}

// Handle OAuth callback from popup
async function handleOAuthCallback(hash) {
  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get('access_token');
  const expiresIn = params.get('expires_in');
  
  if (!accessToken) {
    return { error: 'No access token' };
  }
  
  // Get user info
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  
  if (!userInfoRes.ok) {
    return { error: 'Failed to get user info' };
  }
  
  const userInfo = await userInfoRes.json();
  
  // Send to our backend to create/update user
  const response = await fetch(`${API_URL}/api/auth/callback${hash}`);
  const data = await response.json();
  
  if (data.error) {
    return { error: data.error };
  }
  
  return { user: data.user, accessToken };
}

async function signOut() {
  await localDB.clearAuth();
  currentUser = null;
  currentList = null;
  savedLists = [];
  showLoginScreen();
}

// Load saved lists from server
async function loadSavedLists() {
  const token = await localDB.getAuthToken();
  const response = await fetch(`${API_URL}/api/lists`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (response.ok) {
    const data = await response.json();
    savedLists = data.lists || [];
    await localDB.setMeta('savedLists', savedLists);
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  
  try {
    const registration = await navigator.serviceWorker.register('sw.js');
    
    setInterval(() => {
      registration.update();
    }, 60000);
    
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('New version available, reloading...');
          window.location.reload();
        }
      });
    });
    
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data.type === 'SYNC_NOW') {
        syncNow();
      }
    });
    
  } catch (err) {
    console.error('SW registration failed:', err);
  }
}

let deferredPrompt = null;

function setupPwaInstall() {
  // Hide install button by default
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    // Check if user has already dismissed or installed
    const dismissed = localStorage.getItem('pwaInstallDismissed');
    if (!dismissed && !window.matchMedia('(display-mode: standalone)').matches) {
      showPwaInstallBanner();
    }
  });
  
  // Check if already installed
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hidePwaInstallBanner();
  });
}

function showPwaInstallBanner() {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) {
    banner.classList.remove('hidden');
  }
}

function hidePwaInstallBanner() {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
}

async function installPwa() {
  if (!deferredPrompt) return;
  
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  
  if (outcome === 'accepted') {
    deferredPrompt = null;
  } else if (outcome === 'dismissed') {
    localStorage.setItem('pwaInstallDismissed', 'true');
  }
  
  hidePwaInstallBanner();
}

function dismissPwaInstall() {
  localStorage.setItem('pwaInstallDismissed', 'true');
  hidePwaInstallBanner();
}

async function saveListsToStorage() {
  await localDB.setMeta('savedLists', savedLists);
}

async function addOrUpdateSavedList(listInfo) {
  const existingIndex = savedLists.findIndex(l => l.id === listInfo.id);
  if (existingIndex >= 0) {
    savedLists[existingIndex] = { ...savedLists[existingIndex], ...listInfo, lastAccessed: Date.now() };
  } else {
    savedLists.push({ ...listInfo, lastAccessed: Date.now() });
  }
  await saveListsToStorage();
}

async function removeSavedList(listId) {
  savedLists = savedLists.filter(l => l.id !== listId);
  await saveListsToStorage();
  
  if (currentList && currentList.id === listId) {
    if (savedLists.length > 0) {
      await switchToList(savedLists[0]);
    } else {
      currentList = null;
      if (syncInterval) clearInterval(syncInterval);
      showCreateFirstListPrompt();
    }
  }
}

async function switchToList(listInfo) {
  if (syncInterval) clearInterval(syncInterval);
  
  currentList = listInfo;
  await localDB.setMeta('lastUsedListId', listInfo.id);
  await addOrUpdateSavedList(listInfo);
  
  categories = [];
  await loadListData(listInfo.id);
  
  hideCreateFirstListPrompt();
  await loadData();
  startSync();
}

async function loadListData(listId) {
  categories = await localDB.getCategories();
}

async function toggleAddSection(forceCollapse = null) {
  const toggleBtn = document.getElementById('add-toggle');
  const form = document.getElementById('add-form');
  const isCurrentlyCollapsed = form.classList.contains('collapsed');
  const shouldCollapse = forceCollapse !== null ? forceCollapse : !isCurrentlyCollapsed;
  
  if (shouldCollapse) {
    form.classList.add('collapsed');
    toggleBtn.classList.add('collapsed');
    await localDB.setMeta('addSectionCollapsed', true);
  } else {
    form.classList.remove('collapsed');
    toggleBtn.classList.remove('collapsed');
    await localDB.setMeta('addSectionCollapsed', false);
    document.getElementById('new-item').focus();
  }
}

async function createList() {
  const name = document.getElementById('new-list-name').value.trim();
  
  if (!name) {
    alert('Please enter a list name');
    return;
  }
  
  const token = await localDB.getAuthToken();
  
  try {
    const response = await fetch(`${API_URL}/api/list`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name })
    });
    
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    const newList = { id: data.id, name, access: data.access };
    await addOrUpdateSavedList(newList);
    
    await localDB.saveCategory({
      id: data.defaultCategoryId,
      name: 'Uncategorized',
      sortOrder: 0,
      updatedAt: new Date().toISOString()
    });
    
    document.getElementById('new-list-name').value = '';
    
    await switchToList(newList);
    showShareModal();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function openList(listId) {
  const token = await localDB.getAuthToken();
  
  const response = await fetch(`${API_URL}/api/list/${listId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  
  const listInfo = { id: data.id, name: data.name, access: data.access };
  await addOrUpdateSavedList(listInfo);
  
  await localDB.clearItems();
  await localDB.clearCategories();
  
  for (const item of data.items) {
    await localDB.saveItem({
      id: item.id,
      text: item.text,
      categoryId: item.categoryId,
      completed: item.completed,
      updatedAt: item.updatedAt
    });
  }
  
  for (const category of data.categories) {
    await localDB.saveCategory({
      id: category.id,
      name: category.name,
      sortOrder: category.sortOrder,
      updatedAt: new Date().toISOString()
    });
  }
  
  await switchToList(listInfo);
}

function showCreateNewListModal() {
  hideListSwitcher();
  document.getElementById('setup-modal').classList.remove('hidden');
  document.getElementById('setup-modal').querySelector('h2').textContent = 'Create New List';
  document.getElementById('create-list-section').classList.remove('hidden');
}

function hideSetupModal() {
  document.getElementById('setup-modal').classList.add('hidden');
}

// List Switcher Modal
function showListSwitcher() {
  renderSavedLists();
  document.getElementById('list-switcher-modal').classList.remove('hidden');
}

function hideListSwitcher() {
  document.getElementById('list-switcher-modal').classList.add('hidden');
}

function closeListSwitcher(event) {
  if (event.target === event.currentTarget) {
    hideListSwitcher();
  }
}

function renderSavedLists() {
  const container = document.getElementById('saved-lists-container');
  
  if (savedLists.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">No lists yet</p>';
    return;
  }
  
  const sortedLists = [...savedLists].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  
  container.innerHTML = sortedLists.map(list => `
    <div class="saved-list-item ${currentList && currentList.id === list.id ? 'active' : ''}" 
         onclick="selectListFromSwitcher('${list.id}')">
      <div class="saved-list-info">
        <div class="saved-list-name">${escapeHtml(list.name)}</div>
        <div class="saved-list-id">${list.access === 'owner' ? 'Owner' : 'Collaborator'}</div>
      </div>
      <div class="saved-list-actions" onclick="event.stopPropagation()">
        ${list.access === 'owner' ? `
        <button class="list-action-btn" onclick="showShareListModal('${list.id}')" title="Share">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        </button>
        ` : ''}
        ${list.access === 'owner' ? `
        <button class="list-action-btn" onclick="showListShares('${list.id}')" title="Manage shares">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </button>
        ` : ''}
        <button class="list-action-btn" onclick="deleteSavedList('${list.id}')" title="Remove">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

async function selectListFromSwitcher(listId) {
  const list = savedLists.find(l => l.id === listId);
  if (list && (!currentList || currentList.id !== listId)) {
    await openList(listId);
  }
  hideListSwitcher();
}

async function deleteSavedList(listId) {
  const list = savedLists.find(l => l.id === listId);
  const accessText = list?.access === 'owner' ? 'This will remove the list from your device.' : 'This will remove the shared list from your device.';
  
  if (!confirm(accessText)) {
    return;
  }
  
  await removeSavedList(listId);
  renderSavedLists();
}

// Share Modal
function showShareModal() {
  if (!currentList) return;
  
  document.getElementById('share-list-name').textContent = currentList.name;
  document.getElementById('share-email').value = '';
  document.getElementById('share-section').classList.remove('hidden');
  document.getElementById('shares-list-section').classList.add('hidden');
  
  document.getElementById('share-modal').classList.remove('hidden');
}

async function showShareListModal(listId) {
  const list = savedLists.find(l => l.id === listId);
  if (!list) return;
  
  currentList = list;
  showShareModal();
  
  const originalHide = hideShareModal;
  hideShareModal = function() {
    originalHide();
    hideShareModal = originalHide;
  };
}

async function showListShares(listId) {
  const token = await localDB.getAuthToken();
  
  try {
    const response = await fetch(`${API_URL}/api/list/${listId}/shares`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const data = await response.json();
    
    const list = savedLists.find(l => l.id === listId);
    currentList = list;
    
    document.getElementById('share-list-name').textContent = list.name;
    document.getElementById('shares-list-section').classList.remove('hidden');
    document.getElementById('share-section').classList.add('hidden');
    
    const sharesContainer = document.getElementById('shares-list-container');
    
    if (!data.shares || data.shares.length === 0) {
      sharesContainer.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">No collaborators yet</p>';
    } else {
      sharesContainer.innerHTML = data.shares.map(share => `
        <div class="share-item">
          <div class="share-user-info">
            ${share.picture ? `<img src="${escapeHtml(share.picture)}" class="share-avatar">` : '<div class="share-avatar-placeholder"></div>'}
            <div>
              <div class="share-user-name">${escapeHtml(share.name || share.email)}</div>
              <div class="share-user-email">${escapeHtml(share.email)}</div>
            </div>
          </div>
          <button class="list-action-btn" onclick="removeShare('${listId}', '${share.id}')" title="Remove access">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `).join('');
    }
    
    document.getElementById('share-modal').classList.remove('hidden');
    
    const originalHide = hideShareModal;
    hideShareModal = function() {
      document.getElementById('share-section').classList.remove('hidden');
      document.getElementById('shares-list-section').classList.add('hidden');
      originalHide();
      hideShareModal = originalHide;
    };
    
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function hideShareModal() {
  document.getElementById('share-modal').classList.add('hidden');
}

function closeShareModal(event) {
  if (event.target === event.currentTarget) {
    hideShareModal();
  }
}

async function shareListWithEmail() {
  const email = document.getElementById('share-email').value.trim();
  
  if (!email) {
    alert('Please enter an email address');
    return;
  }
  
  if (!currentList || currentList.access !== 'owner') {
    alert('Only the owner can share lists');
    return;
  }
  
  const token = await localDB.getAuthToken();
  
  try {
    const response = await fetch(`${API_URL}/api/list/${currentList.id}/share`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ email })
    });
    
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    alert(`List shared with ${email}`);
    document.getElementById('share-email').value = '';
    
    // Refresh shares
    showListShares(currentList.id);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function removeShare(listId, shareUserId) {
  if (!confirm('Remove this user\'s access to the list?')) {
    return;
  }
  
  const token = await localDB.getAuthToken();
  
  try {
    await fetch(`${API_URL}/api/list/${listId}/share/${shareUserId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    // Refresh shares
    showListShares(listId);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function setupCategoryInput() {
  const itemInput = document.getElementById('new-item');
  const categorySelect = document.getElementById('category-select');
  const newCategoryInput = document.getElementById('new-category');
  
  itemInput.addEventListener('input', async (e) => {
    const text = e.target.value.trim();
    if (text.length > 2) {
      const suggestedCategoryId = await localDB.suggestCategoryForItem(text);
      if (suggestedCategoryId) {
        categorySelect.value = suggestedCategoryId;
      }
    }
  });
  
  categorySelect.addEventListener('change', (e) => {
    if (e.target.value === '__new__') {
      newCategoryInput.classList.remove('hidden');
      newCategoryInput.focus();
    } else {
      newCategoryInput.classList.add('hidden');
    }
  });
}

async function addItem(event) {
  event.preventDefault();
  
  const input = document.getElementById('new-item');
  const text = input.value.trim();
  if (!text) return;
  
  const categorySelect = document.getElementById('category-select');
  const newCategoryInput = document.getElementById('new-category');
  
  let categoryId = categorySelect.value;
  
  if (!categoryId || categoryId === '') {
    if (categories.length > 0) {
      categoryId = categories[0].id;
    } else {
      categoryId = null;
    }
  }
  
  if (categoryId === '__new__') {
    const newName = newCategoryInput.value.trim();
    if (!newName) {
      alert('Please enter a category name');
      return;
    }
    
    const existing = await localDB.getCategoryByName(newName);
    if (existing) {
      categoryId = existing.id;
    } else {
      categoryId = generateId();
      const maxOrder = categories.length > 0 ? Math.max(...categories.map(c => c.sortOrder)) : -1;
      const timestamp = new Date().toISOString();
      
      const newCategory = {
        id: categoryId,
        name: newName,
        sortOrder: maxOrder + 1,
        updatedAt: timestamp
      };
      
      await localDB.saveCategory(newCategory);
      await localDB.queueChange({
        type: 'category_add',
        id: categoryId,
        name: newName,
        sortOrder: maxOrder + 1,
        timestamp
      });
      
      categories.push(newCategory);
      updateCategoryDropdown();
      
      categorySelect.value = categoryId;
    }
    
    newCategoryInput.value = '';
    newCategoryInput.classList.add('hidden');
  }
  
  const item = {
    id: generateId(),
    text,
    categoryId: categoryId || null,
    completed: false,
    updatedAt: new Date().toISOString()
  };
  
  await localDB.saveItem(item);
  await localDB.queueChange({
    type: 'add',
    id: item.id,
    categoryId,
    text: item.text,
    completed: item.completed,
    timestamp: item.updatedAt
  });
  
  input.value = '';
  await renderItems();
  updateCategoryDropdown();
  
  if (navigator.onLine) {
    syncNow();
  }
}

async function toggleItem(id) {
  const items = await localDB.getItems();
  const item = items.find(i => i.id === id);
  if (!item) return;
  
  item.completed = !item.completed;
  item.updatedAt = new Date().toISOString();
  
  await localDB.saveItem(item);
  await localDB.queueChange({
    type: 'update',
    id: item.id,
    categoryId: item.categoryId,
    text: item.text,
    completed: item.completed,
    timestamp: item.updatedAt
  });
  
  await renderItems();
  
  if (navigator.onLine) {
    syncNow();
  }
}

async function deleteItem(id) {
  const item = await localDB.getItem(id);
  await localDB.saveItem({
    id,
    deleted: true,
    updatedAt: new Date().toISOString()
  });
  await localDB.queueChange({
    type: 'delete',
    id,
    timestamp: new Date().toISOString()
  });
  
  await renderItems();
  
  if (navigator.onLine) {
    syncNow();
  }
}

async function clearCompletedItems() {
  const items = await localDB.getItems();
  const completedItems = items.filter(item => item.completed);
  
  if (completedItems.length === 0) {
    return;
  }
  
  if (!confirm(`Delete ${completedItems.length} completed item${completedItems.length === 1 ? '' : 's'}?`)) {
    return;
  }
  
  const timestamp = new Date().toISOString();
  
  for (const item of completedItems) {
    await localDB.saveItem({
      id: item.id,
      deleted: true,
      updatedAt: timestamp
    });
    await localDB.queueChange({
      type: 'delete',
      id: item.id,
      timestamp
    });
  }
  
  await renderItems();
  
  if (navigator.onLine) {
    syncNow();
  }
}

async function loadData() {
  document.getElementById('list-title').textContent = currentList.name;
  document.getElementById('list-info').textContent = currentList.access === 'owner' ? 'Owner' : 'Collaborator';
  categories = await localDB.getCategories();
  await renderItems();
  updateCategoryDropdown();
}

async function renderItems() {
  const items = await localDB.getItems();
  const container = document.getElementById('items-container');
  const empty = document.getElementById('empty-state');
  
  if (items.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  
  empty.classList.add('hidden');
  
  const itemsByCategory = {};
  categories.forEach(cat => {
    itemsByCategory[cat.id] = { category: cat, items: [] };
  });
  
  if (!itemsByCategory['null']) {
    itemsByCategory['null'] = { 
      category: { id: null, name: 'Uncategorized', sortOrder: 999 }, 
      items: [] 
    };
  }
  
  items.forEach(item => {
    const catId = item.categoryId || 'null';
    if (!itemsByCategory[catId]) {
      itemsByCategory[catId] = { 
        category: categories.find(c => c.id === catId) || { id: catId, name: 'Unknown', sortOrder: 999 },
        items: [] 
      };
    }
    itemsByCategory[catId].items.push(item);
  });
  
  const sortedCategories = Object.values(itemsByCategory)
    .filter(group => group.items.length > 0)
    .sort((a, b) => a.category.sortOrder - b.category.sortOrder);
  
  container.innerHTML = sortedCategories.map((group, index) => `
    <div class="category-group ${group.category.id === null ? 'uncategorized' : ''}" 
         data-category-id="${group.category.id || 'null'}"
         draggable="true">
      <div class="category-header">
        <span class="drag-handle">⋮⋮</span>
        <span class="category-name">${escapeHtml(group.category.name)}</span>
        <span class="category-count">(${group.items.length})</span>
        ${group.category.id !== null && group.category.id !== 'null' ? `
          <button class="category-delete" onclick="deleteCategory('${group.category.id}')" title="Delete category">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        ` : ''}
      </div>
      <ul class="category-items">
        ${group.items.map(item => `
          <li class="item ${item.completed ? 'completed' : ''}">
            <div class="item-checkbox" onclick="toggleItem('${item.id}')"></div>
            <span class="item-text">${escapeHtml(item.text)}</span>
            <button class="item-delete" onclick="deleteItem('${item.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </li>
        `).join('')}
      </ul>
    </div>
  `).join('');
  
  if (typeof Sortable !== 'undefined') {
    if (sortableInstance) {
      sortableInstance.destroy();
    }
    sortableInstance = new Sortable(container, {
      animation: 150,
      handle: '.category-header',
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      onEnd: () => {
        reorderCategories();
      }
    });
  }
}

async function deleteCategory(categoryId) {
  if (!confirm('Delete this category? Items will be moved to Uncategorized.')) {
    return;
  }
  
  const category = categories.find(c => c.id === categoryId);
  if (!category) return;
  
  const timestamp = new Date().toISOString();
  
  await localDB.saveCategory({
    ...category,
    deleted: true,
    updatedAt: timestamp
  });
  
  const items = await localDB.getItems();
  for (const item of items) {
    if (item.categoryId === categoryId) {
      item.categoryId = null;
      item.updatedAt = timestamp;
      await localDB.saveItem(item);
      await localDB.queueChange({
        type: 'update',
        id: item.id,
        categoryId: null,
        text: item.text,
        completed: item.completed,
        timestamp
      });
    }
  }
  
  await localDB.queueChange({
    type: 'category_delete',
    id: categoryId,
    timestamp
  });
  
  categories = categories.filter(c => c.id !== categoryId);
  
  await renderItems();
  updateCategoryDropdown();
  
  if (navigator.onLine) {
    syncNow();
  }
}

function updateCategoryDropdown() {
  const select = document.getElementById('category-select');
  const newCategoryInput = document.getElementById('new-category');
  const currentValue = select.value;
  
  if (currentValue === '__new__' && !newCategoryInput.classList.contains('hidden')) {
    return;
  }
  
  const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
  
  select.innerHTML = [
    '<option value="">Select category...</option>',
    ...sortedCategories.map(cat => 
      `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`
    ),
    '<option value="__new__">+ New category...</option>'
  ].join('');
  
  if (currentValue && currentValue !== '__new__') {
    select.value = currentValue;
  } else if (sortedCategories.length > 0) {
    select.value = sortedCategories[0].id;
  }
}

async function reorderCategories(fromId, toId) {
  const container = document.getElementById('items-container');
  const groups = Array.from(container.querySelectorAll('.category-group'));
  
  const timestamp = new Date().toISOString();
  const categoryChanges = [];
  
  for (let i = 0; i < groups.length; i++) {
    const catId = groups[i].dataset.categoryId;
    if (catId === 'null') continue;
    
    const category = categories.find(c => c.id === catId);
    if (category && category.sortOrder !== i) {
      category.sortOrder = i;
      await localDB.saveCategory(category);
      categoryChanges.push({
        type: 'category_update',
        id: catId,
        name: category.name,
        sortOrder: i,
        timestamp
      });
    }
  }
  
  if (categoryChanges.length > 0) {
    await localDB.queueChange({
      type: 'category_order',
      order: groups.map(g => g.dataset.categoryId).filter(id => id !== 'null'),
      timestamp
    });
    
    categories.sort((a, b) => a.sortOrder - b.sortOrder);
    await renderItems();
    
    if (navigator.onLine) {
      syncNow();
    }
  }
}

function startSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(syncNow, 10000);
  syncNow();
}

async function syncNow() {
  if (!currentList || !navigator.onLine) return;
  
  showSyncStatus('Syncing...', false);
  
  const token = await localDB.getAuthToken();
  
  try {
    const pending = await localDB.getPendingChanges();
    const lastSync = await localDB.getMeta('lastSync') || '1970-01-01';
    
    const itemChanges = pending.filter(p => !p.type.startsWith('category_'));
    const categoryChanges = pending
      .filter(p => p.type.startsWith('category_') && p.type !== 'category_order')
      .map(c => ({
        type: c.type.replace('category_', ''),
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        timestamp: c.timestamp
      }));
    
    const orderChange = pending
      .filter(p => p.type === 'category_order')
      .pop();
    
    const response = await fetch(`${API_URL}/api/list/${currentList.id}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ 
        itemChanges, 
        categoryChanges, 
        categoryOrder: orderChange ? orderChange.order : null,
        lastSync 
      })
    });
    
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    for (const change of data.itemChanges) {
      if (change.type === 'delete') {
        await localDB.deleteItem(change.id);
      } else {
        const existingItem = await localDB.getItem(change.id);
        const categoryId = change.categoryId !== null && change.categoryId !== undefined 
          ? change.categoryId 
          : (existingItem ? existingItem.categoryId : null);
        
        await localDB.saveItem({
          id: change.id,
          categoryId: categoryId,
          text: change.text,
          completed: change.completed,
          updatedAt: change.timestamp
        });
      }
    }
    
    for (const change of data.categoryChanges) {
      if (change.type === 'delete') {
        await localDB.deleteCategory(change.id);
      } else {
        await localDB.saveCategory({
          id: change.id,
          name: change.name,
          sortOrder: change.sortOrder,
          updatedAt: change.timestamp
        });
      }
    }
    
    if (data.categoryOrder) {
      for (let i = 0; i < data.categoryOrder.length; i++) {
        const cat = categories.find(c => c.id === data.categoryOrder[i]);
        if (cat) {
          cat.sortOrder = i;
          await localDB.saveCategory(cat);
        }
      }
    }
    
    categories = await localDB.getCategories();
    
    await localDB.clearPendingChanges();
    await localDB.setMeta('lastSync', data.timestamp);
    
    await renderItems();
    updateCategoryDropdown();
    
    setTimeout(() => hideSyncStatus(), 1000);
  } catch (err) {
    console.error('Sync failed:', err);
    showSyncStatus('Sync failed', true);
    setTimeout(() => hideSyncStatus(), 3000);
  }
}

function showSyncStatus(text, isOffline) {
  const indicator = document.getElementById('sync-indicator');
  indicator.textContent = text;
  indicator.classList.toggle('offline', isOffline);
  indicator.classList.add('show');
}

function hideSyncStatus() {
  document.getElementById('sync-indicator').classList.remove('show');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

async function initTheme() {
  const savedTheme = await localDB.getMeta('theme') || 'system';
  applyTheme(savedTheme);
  
  document.querySelectorAll('.theme-option').forEach(option => {
    option.classList.toggle('active', option.dataset.theme === savedTheme);
    const radio = option.querySelector('input');
    radio.checked = option.dataset.theme === savedTheme;
  });
}

function applyTheme(theme) {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    document.querySelector('meta[name="theme-color"]').setAttribute('content', prefersDark ? '#1C2422' : '#6F978D');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#1C2422' : '#6F978D');
  }
}

async function setTheme(theme) {
  await localDB.setMeta('theme', theme);
  applyTheme(theme);
  
  document.querySelectorAll('.theme-option').forEach(option => {
    option.classList.toggle('active', option.dataset.theme === theme);
  });
}

function showSettingsModal() {
  const modal = document.getElementById('settings-modal');
  modal.classList.remove('hidden');
  
  // Show user info
  const userInfoEl = document.getElementById('settings-user-info');
  if (currentUser) {
    userInfoEl.innerHTML = `
      ${currentUser.picture ? `<img src="${escapeHtml(currentUser.picture)}" style="width: 40px; height: 40px; border-radius: 50%;">` : ''}
      <div>
        <div style="font-weight: 600;">${escapeHtml(currentUser.name || currentUser.email)}</div>
        <div style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(currentUser.email)}</div>
      </div>
    `;
    userInfoEl.classList.remove('hidden');
  }
  
  document.querySelectorAll('.theme-option').forEach(option => {
    const radio = option.querySelector('input');
    radio.onchange = (e) => setTheme(e.target.value);
  });
}

function closeSettingsModal(event) {
  if (event.target.classList.contains('modal-overlay')) {
    event.target.classList.add('hidden');
  }
}

function hideSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
  const savedTheme = await localDB.getMeta('theme') || 'system';
  if (savedTheme === 'system') {
    applyTheme('system');
  }
});

// Open list from URL param (shared link)
async function handleOpenListParam() {
  const urlParams = new URLSearchParams(window.location.search);
  const listId = urlParams.get('list');
  
  if (listId && currentUser) {
    // Clear the param to clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
    
    try {
      await openList(listId);
    } catch (e) {
      console.error('Cannot open shared list:', e);
    }
  }
}

init();
