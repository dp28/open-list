// Main app logic - PWA shopping list with categories
// Works offline, syncs when online

const API_URL = window.location.origin;
const localDB = new LocalDB();

let currentList = null;
let savedLists = [];
let syncInterval = null;
let categories = [];
let draggedCategory = null;

// Initialize
async function init() {
  await localDB.init();
  
  // Load all saved lists
  await loadSavedLists();
  
  // Check for URL parameters first (shared list link)
  const urlParams = new URLSearchParams(window.location.search);
  const sharedListId = urlParams.get('list');
  
  if (sharedListId) {
    // Pre-fill the join modal with the list ID
    document.getElementById('join-list-id').value = sharedListId;
    showSetupTab('join');
    document.getElementById('setup-modal').classList.remove('hidden');
  } else if (savedLists.length > 0) {
    // Load the most recently used list
    const lastUsedList = await localDB.getMeta('lastUsedListId');
    const listToLoad = savedLists.find(l => l.id === lastUsedList) || savedLists[0];
    await switchToList(listToLoad);
  } else {
    // Show setup modal for new users
    document.getElementById('setup-modal').classList.remove('hidden');
  }
  
  // Listen for online/offline
  window.addEventListener('online', () => {
    showSyncStatus('Back online', false);
    syncNow();
  });
  window.addEventListener('offline', () => {
    showSyncStatus('Offline mode', true);
  });
  
  // Register service worker with update handling
  registerServiceWorker();
  
  // Setup category input listeners
  setupCategoryInput();
  
  // Initialize add section state
  const isCollapsed = await localDB.getMeta('addSectionCollapsed');
  if (isCollapsed) {
    toggleAddSection(true);
  }
}

// Load saved lists from storage
async function loadSavedLists() {
  savedLists = await localDB.getMeta('savedLists') || [];
}

// Register service worker and handle updates
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  
  try {
    const registration = await navigator.serviceWorker.register('sw.js');
    
    // Check for updates periodically
    setInterval(() => {
      registration.update();
    }, 60000); // Check every minute
    
    // Handle updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version available - reload to activate
          console.log('New version available, reloading...');
          window.location.reload();
        }
      });
    });
    
    // Listen for messages from service worker
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data.type === 'SYNC_NOW') {
        syncNow();
      }
    });
    
  } catch (err) {
    console.error('SW registration failed:', err);
  }
}

// Save lists to storage
async function saveListsToStorage() {
  await localDB.setMeta('savedLists', savedLists);
}

// Add or update a list in saved lists
async function addOrUpdateSavedList(listInfo) {
  const existingIndex = savedLists.findIndex(l => l.id === listInfo.id);
  if (existingIndex >= 0) {
    savedLists[existingIndex] = { ...savedLists[existingIndex], ...listInfo, lastAccessed: Date.now() };
  } else {
    savedLists.push({ ...listInfo, lastAccessed: Date.now() });
  }
  await saveListsToStorage();
}

// Remove a list from saved lists
async function removeSavedList(listId) {
  savedLists = savedLists.filter(l => l.id !== listId);
  await saveListsToStorage();
  
  // If we removed the current list, switch to another one or show setup
  if (currentList && currentList.id === listId) {
    if (savedLists.length > 0) {
      await switchToList(savedLists[0]);
    } else {
      currentList = null;
      if (syncInterval) clearInterval(syncInterval);
      document.getElementById('setup-modal').classList.remove('hidden');
    }
  }
}

// Switch to a specific list
async function switchToList(listInfo) {
  // Stop current sync
  if (syncInterval) clearInterval(syncInterval);
  
  currentList = listInfo;
  await localDB.setMeta('lastUsedListId', listInfo.id);
  await addOrUpdateSavedList(listInfo);
  
  // Clear current data and load list-specific data
  categories = [];
  await loadListData(listInfo.id);
  
  // Update UI
  document.getElementById('setup-modal').classList.add('hidden');
  await loadData();
  startSync();
}

// Load list-specific data from local DB
async function loadListData(listId) {
  // The data is already stored list-specific in the DB
  // We just need to reload categories
  categories = await localDB.getCategories();
}

// Toggle add section visibility
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
    // Focus on item input when expanding
    document.getElementById('new-item').focus();
  }
}

// UI Helpers
function showSetupTab(tab) {
  document.querySelectorAll('#setup-modal .tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  
  document.getElementById('create-tab').classList.toggle('hidden', tab !== 'create');
  document.getElementById('join-tab').classList.toggle('hidden', tab !== 'join');
}

async function createList() {
  const name = document.getElementById('new-list-name').value.trim();
  const pin = document.getElementById('new-list-pin').value.trim();
  
  if (!name || !pin) {
    alert('Please enter a name and PIN');
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/api/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pin })
    });
    
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    const newList = { id: data.id, name, pin };
    await addOrUpdateSavedList(newList);
    
    // Save default category
    await localDB.saveCategory({
      id: data.defaultCategoryId,
      name: 'Uncategorized',
      sortOrder: 0,
      updatedAt: new Date().toISOString()
    });
    
    // Clear form
    document.getElementById('new-list-name').value = '';
    document.getElementById('new-list-pin').value = '';
    
    await switchToList(newList);
    
    // Show share modal after creating
    showShareModal();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function joinList() {
  const id = document.getElementById('join-list-id').value.trim();
  const pin = document.getElementById('join-list-pin').value.trim();
  
  if (!id || !pin) {
    alert('Please enter list ID and PIN');
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/api/list`, {
      headers: {
        'X-List-ID': id,
        'X-List-PIN': pin
      }
    });
    
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    const joinedList = { id, name: data.name, pin };
    await addOrUpdateSavedList(joinedList);
    
    // Save server data locally
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
    
    // Clear form
    document.getElementById('join-list-id').value = '';
    document.getElementById('join-list-pin').value = '';
    
    await switchToList(joinedList);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// Show create new list modal from within the app
function showCreateNewListModal() {
  hideListSwitcher();
  showSetupTab('create');
  document.getElementById('setup-modal').classList.remove('hidden');
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
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No saved lists</p>';
    return;
  }
  
  // Sort by last accessed (most recent first)
  const sortedLists = [...savedLists].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  
  container.innerHTML = sortedLists.map(list => `
    <div class="saved-list-item ${currentList && currentList.id === list.id ? 'active' : ''}" 
         onclick="selectListFromSwitcher('${list.id}')">
      <div class="saved-list-info">
        <div class="saved-list-name">${escapeHtml(list.name)}</div>
        <div class="saved-list-id">ID: ${list.id}</div>
      </div>
      <div class="saved-list-actions" onclick="event.stopPropagation()">
        <button class="list-action-btn" onclick="shareList('${list.id}')" title="Share">🔗</button>
        <button class="list-action-btn" onclick="deleteSavedList('${list.id}')" title="Remove">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function selectListFromSwitcher(listId) {
  const list = savedLists.find(l => l.id === listId);
  if (list && (!currentList || currentList.id !== listId)) {
    await switchToList(list);
  }
  hideListSwitcher();
}

async function deleteSavedList(listId) {
  if (!confirm('Remove this list from your device? You can re-join it later with the ID and PIN.')) {
    return;
  }
  
  await removeSavedList(listId);
  renderSavedLists();
}

// Share Modal
function showShareModal() {
  if (!currentList) return;
  
  const shareUrl = `${window.location.origin}?list=${currentList.id}`;
  document.getElementById('share-list-name').textContent = currentList.name;
  document.getElementById('share-url').value = shareUrl;
  
  // Show native share button if available
  const nativeShareBtn = document.getElementById('native-share-btn');
  if (navigator.share) {
    nativeShareBtn.classList.remove('hidden');
  } else {
    nativeShareBtn.classList.add('hidden');
  }
  
  document.getElementById('share-modal').classList.remove('hidden');
}

function hideShareModal() {
  document.getElementById('share-modal').classList.add('hidden');
}

function closeShareModal(event) {
  if (event.target === event.currentTarget) {
    hideShareModal();
  }
}

async function copyShareUrl() {
  const shareUrlInput = document.getElementById('share-url');
  shareUrlInput.select();
  
  try {
    await navigator.clipboard.writeText(shareUrlInput.value);
    const copyBtn = document.querySelector('.copy-btn');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  } catch (err) {
    // Fallback for older browsers
    document.execCommand('copy');
    alert('Link copied to clipboard!');
  }
}

async function shareViaNative() {
  if (!currentList) return;
  
  const shareUrl = `${window.location.origin}?list=${currentList.id}`;
  
  if (navigator.share) {
    try {
      await navigator.share({
        title: `Join ${currentList.name}`,
        text: `Join my shopping list "${currentList.name}"`,
        url: shareUrl
      });
    } catch (err) {
      // User cancelled or share failed
      console.log('Share cancelled or failed:', err);
    }
  }
}

// Share a specific list (used from list switcher)
function shareList(listId) {
  const list = savedLists.find(l => l.id === listId);
  if (!list) return;
  
  // Temporarily set as current for sharing, then restore
  const previousList = currentList;
  currentList = list;
  showShareModal();
  
  // Restore when modal closes
  const originalHide = hideShareModal;
  hideShareModal = function() {
    currentList = previousList;
    originalHide();
    hideShareModal = originalHide;
  };
}

// Category input with auto-suggest
function setupCategoryInput() {
  const itemInput = document.getElementById('new-item');
  const categorySelect = document.getElementById('category-select');
  const newCategoryInput = document.getElementById('new-category');
  
  // Auto-suggest category when typing item
  itemInput.addEventListener('input', async (e) => {
    const text = e.target.value.trim();
    if (text.length > 2) {
      const suggestedCategoryId = await localDB.suggestCategoryForItem(text);
      if (suggestedCategoryId) {
        categorySelect.value = suggestedCategoryId;
      }
    }
  });
  
  // Handle "New category" selection
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
  
  // Handle empty selection - use first category or null
  if (!categoryId || categoryId === '') {
    if (categories.length > 0) {
      categoryId = categories[0].id;
    } else {
      categoryId = null;
    }
  }
  
  // Handle new category
  if (categoryId === '__new__') {
    const newName = newCategoryInput.value.trim();
    if (!newName) {
      alert('Please enter a category name');
      return;
    }
    
    // Check if category already exists
    const existing = await localDB.getCategoryByName(newName);
    if (existing) {
      categoryId = existing.id;
    } else {
      // Create new category
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
      
      // Select the newly created category
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
  
  // Save locally first
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
  
  // Try to sync immediately
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
    return; // No completed items to clear
  }
  
  if (!confirm(`Delete ${completedItems.length} completed item${completedItems.length === 1 ? '' : 's'}?`)) {
    return;
  }
  
  const timestamp = new Date().toISOString();
  
  // Mark all completed items as deleted
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
  document.getElementById('list-info').textContent = `ID: ${currentList.id}`;
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
  
  // Group items by category
  const itemsByCategory = {};
  categories.forEach(cat => {
    itemsByCategory[cat.id] = { category: cat, items: [] };
  });
  
  // Add Uncategorized group if not exists
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
  
  // Sort categories by sortOrder
  const sortedCategories = Object.values(itemsByCategory)
    .filter(group => group.items.length > 0)
    .sort((a, b) => a.category.sortOrder - b.category.sortOrder);
  
  // Render compact grouped view
  container.innerHTML = sortedCategories.map((group, index) => `
    <div class="category-group ${group.category.id === null ? 'uncategorized' : ''}" 
         data-category-id="${group.category.id || 'null'}"
         draggable="true">
      <div class="category-header">
        <span class="drag-handle">⋮⋮</span>
        <span class="category-name">${escapeHtml(group.category.name)}</span>
        <span class="category-count">(${group.items.length})</span>
        ${group.category.id !== null && group.category.id !== 'null' ? `
          <button class="category-delete" onclick="deleteCategory('${group.category.id}')" title="Delete category">×</button>
        ` : ''}
      </div>
      <ul class="category-items">
        ${group.items.map(item => `
          <li class="item ${item.completed ? 'completed' : ''}">
            <div class="item-checkbox" onclick="toggleItem('${item.id}')"></div>
            <span class="item-text">${escapeHtml(item.text)}</span>
            <button class="item-delete" onclick="deleteItem('${item.id}')">×</button>
          </li>
        `).join('')}
      </ul>
    </div>
  `).join('');
  
  // Attach drag and touch event listeners
  container.querySelectorAll('.category-group').forEach(group => {
    const categoryId = group.dataset.categoryId;
    group.addEventListener('dragstart', (e) => handleDragStart(e, categoryId));
    group.addEventListener('dragover', handleDragOver);
    group.addEventListener('drop', (e) => handleDrop(e, categoryId));
    group.addEventListener('dragend', handleDragEnd);
    
    // Touch events for mobile
    group.addEventListener('touchstart', (e) => handleTouchStart(e, categoryId), { passive: true });
    group.addEventListener('touchmove', (e) => handleTouchMove(e, categoryId), { passive: true });
    group.addEventListener('touchend', (e) => handleTouchEnd(e, categoryId));
  });
}

async function deleteCategory(categoryId) {
  if (!confirm('Delete this category? Items will be moved to Uncategorized.')) {
    return;
  }
  
  const category = categories.find(c => c.id === categoryId);
  if (!category) return;
  
  const timestamp = new Date().toISOString();
  
  // Mark category as deleted locally
  await localDB.saveCategory({
    ...category,
    deleted: true,
    updatedAt: timestamp
  });
  
  // Move items in this category to Uncategorized (null)
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
  
  // Queue category deletion
  await localDB.queueChange({
    type: 'category_delete',
    id: categoryId,
    timestamp
  });
  
  // Update local categories array
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
  
  // Don't update if user is creating a new category
  if (currentValue === '__new__' && !newCategoryInput.classList.contains('hidden')) {
    return;
  }
  
  // Sort categories alphabetically for dropdown
  const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
  
  select.innerHTML = [
    '<option value="">Select category...</option>',
    ...sortedCategories.map(cat => 
      `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`
    ),
    '<option value="__new__">+ New category...</option>'
  ].join('');
  
  // Restore selection or default to first category
  if (currentValue && currentValue !== '__new__') {
    select.value = currentValue;
  } else if (sortedCategories.length > 0) {
    select.value = sortedCategories[0].id;
  }
}

// Drag and drop for category reordering
function handleDragStart(event, categoryId) {
  draggedCategory = categoryId;
  event.target.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

function handleDrop(event, targetCategoryId) {
  event.preventDefault();
  if (draggedCategory === targetCategoryId) return;
  
  reorderCategories(draggedCategory, targetCategoryId);
}

function handleDragEnd() {
  document.querySelectorAll('.category-group').forEach(el => {
    el.classList.remove('dragging');
  });
  draggedCategory = null;
}

// Touch handling for mobile
let touchStartY = 0;
let touchStartX = 0;
let touchCategoryId = null;
let touchMoved = false;

function handleTouchStart(event, categoryId) {
  const touch = event.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  touchCategoryId = categoryId;
  touchMoved = false;
}

function handleTouchMove(event, categoryId) {
  if (!touchCategoryId || touchCategoryId !== categoryId) return;
  
  const touch = event.touches[0];
  const deltaY = Math.abs(touch.clientY - touchStartY);
  const deltaX = Math.abs(touch.clientX - touchStartX);
  
  // Detect if this is a vertical scroll (not a drag)
  if (deltaY > 10 && deltaY > deltaX) {
    touchMoved = true;
  }
}

function handleTouchEnd(event, categoryId) {
  if (!touchCategoryId || touchCategoryId !== categoryId) {
    touchCategoryId = null;
    return;
  }
  
  // Only trigger reorder if user was actually dragging, not scrolling
  if (touchMoved) {
    const container = document.getElementById('items-container');
    const groups = Array.from(container.querySelectorAll('.category-group'));
    const currentIndex = groups.findIndex(g => g.dataset.categoryId === touchCategoryId);
    
    if (currentIndex > 0) {
      // Drop above the previous category
      const targetId = groups[currentIndex - 1].dataset.categoryId;
      reorderCategories(touchCategoryId, targetId);
    }
  }
  
  touchCategoryId = null;
  touchMoved = false;
}

async function reorderCategories(fromId, toId) {
  // Get current order
  const container = document.getElementById('items-container');
  const groups = Array.from(container.querySelectorAll('.category-group'));
  const newOrder = groups.map(g => g.dataset.categoryId);
  
  // Move dragged category before target
  const fromIndex = newOrder.indexOf(fromId);
  const toIndex = newOrder.indexOf(toId);
  
  if (fromIndex === -1 || toIndex === -1) return;
  
  newOrder.splice(fromIndex, 1);
  newOrder.splice(toIndex, 0, fromId);
  
  // Update sortOrder for each category
  const timestamp = new Date().toISOString();
  const categoryChanges = [];
  
  for (let i = 0; i < newOrder.length; i++) {
    const catId = newOrder[i];
    if (catId === 'null') continue; // Skip Uncategorized
    
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
  
  // Queue category order change
  if (categoryChanges.length > 0) {
    await localDB.queueChange({
      type: 'category_order',
      order: newOrder.filter(id => id !== 'null'),
      timestamp
    });
    
    // Re-render with new order
    categories.sort((a, b) => a.sortOrder - b.sortOrder);
    await renderItems();
    
    if (navigator.onLine) {
      syncNow();
    }
  }
}

// Sync logic
function startSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(syncNow, 10000);
  syncNow();
}

async function syncNow() {
  if (!currentList || !navigator.onLine) return;
  
  showSyncStatus('Syncing...', false);
  
  try {
    const pending = await localDB.getPendingChanges();
    const lastSync = await localDB.getMeta('lastSync') || '1970-01-01';
    
    // Separate item and category changes
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
    
    // Get category order changes (use latest)
    const orderChange = pending
      .filter(p => p.type === 'category_order')
      .pop();
    

    
    const response = await fetch(`${API_URL}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-List-ID': currentList.id,
        'X-List-PIN': currentList.pin
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
    
    // Apply server item changes
    for (const change of data.itemChanges) {
      if (change.type === 'delete') {
        await localDB.deleteItem(change.id);
      } else {
        // Get existing item to preserve category if server returns null
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
    
    // Apply server category changes
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
    
    // Update local categories with server order
    if (data.categoryOrder) {
      for (let i = 0; i < data.categoryOrder.length; i++) {
        const cat = categories.find(c => c.id === data.categoryOrder[i]);
        if (cat) {
          cat.sortOrder = i;
          await localDB.saveCategory(cat);
        }
      }
    }
    
    // Refresh categories
    categories = await localDB.getCategories();
    
    // Clear pending since server processed them
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

// Start
init();
