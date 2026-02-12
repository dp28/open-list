// Main app logic - PWA shopping list
// Works offline, syncs when online

const API_URL = ''; // Same origin (deployed to Pages, API is Worker)
const localDB = new LocalDB();

let currentList = null;
let syncInterval = null;

// Initialize
async function init() {
  await localDB.init();
  
  // Check for saved list credentials
  const savedList = await localDB.getMeta('currentList');
  if (savedList) {
    currentList = savedList;
    document.getElementById('setup-modal').classList.add('hidden');
    await loadItems();
    startSync();
  }
  
  // Listen for online/offline
  window.addEventListener('online', () => {
    showSyncStatus('Back online', false);
    syncNow();
  });
  window.addEventListener('offline', () => {
    showSyncStatus('Offline mode', true);
  });
  
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
}

// UI Helpers
function showTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
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
    
    currentList = { id: data.id, name, pin };
    await localDB.setMeta('currentList', currentList);
    
    document.getElementById('setup-modal').classList.add('hidden');
    await loadItems();
    startSync();
    
    // Share link
    const shareUrl = `${window.location.origin}?list=${data.id}`;
    if (navigator.share) {
      navigator.share({
        title: `Join ${name}`,
        text: `PIN: ${pin}`,
        url: shareUrl
      });
    }
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
    
    currentList = { id, name: data.name, pin };
    await localDB.setMeta('currentList', currentList);
    
    // Save server items locally
    await localDB.clearItems();
    for (const item of data.items) {
      await localDB.saveItem({
        id: item.id,
        text: item.text,
        completed: item.completed,
        updatedAt: item.updatedAt
      });
    }
    
    document.getElementById('setup-modal').classList.add('hidden');
    await loadItems();
    startSync();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function addItem(event) {
  event.preventDefault();
  
  const input = document.getElementById('new-item');
  const text = input.value.trim();
  if (!text) return;
  
  const item = {
    id: generateId(),
    text,
    completed: false,
    updatedAt: new Date().toISOString()
  };
  
  // Save locally first
  await localDB.saveItem(item);
  await localDB.queueChange({
    type: 'add',
    id: item.id,
    text: item.text,
    completed: item.completed,
    timestamp: item.updatedAt
  });
  
  input.value = '';
  await renderItems();
  
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

async function loadItems() {
  document.getElementById('list-title').textContent = currentList.name;
  document.getElementById('list-info').textContent = `ID: ${currentList.id}`;
  await renderItems();
}

async function renderItems() {
  const items = await localDB.getItems();
  const list = document.getElementById('items-list');
  const empty = document.getElementById('empty-state');
  
  if (items.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  
  empty.classList.add('hidden');
  list.innerHTML = items.map(item => `
    <li class="item ${item.completed ? 'completed' : ''}">
      <div class="item-checkbox" onclick="toggleItem('${item.id}')"></div>
      <span class="item-text">${escapeHtml(item.text)}</span>
      <button class="item-delete" onclick="deleteItem('${item.id}')">Delete</button>
    </li>
  `).join('');
}

// Sync logic
function startSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(syncNow, 10000); // Sync every 10 seconds
  syncNow(); // Initial sync
}

async function syncNow() {
  if (!currentList || !navigator.onLine) return;
  
  showSyncStatus('Syncing...', false);
  
  try {
    const pending = await localDB.getPendingChanges();
    const lastSync = await localDB.getMeta('lastSync') || '1970-01-01';
    
    const response = await fetch(`${API_URL}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-List-ID': currentList.id,
        'X-List-PIN': currentList.pin
      },
      body: JSON.stringify({ changes: pending, lastSync })
    });
    
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    // Apply server changes
    for (const change of data.changes) {
      if (change.type === 'delete') {
        await localDB.deleteItem(change.id);
      } else {
        await localDB.saveItem({
          id: change.id,
          text: change.text,
          completed: change.completed,
          updatedAt: change.timestamp
        });
      }
    }
    
    // Clear pending since server processed them
    await localDB.clearPendingChanges();
    await localDB.setMeta('lastSync', data.timestamp);
    
    await renderItems();
    
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

// Check for shared URL
const urlParams = new URLSearchParams(window.location.search);
const sharedListId = urlParams.get('list');
if (sharedListId) {
  document.getElementById('join-list-id').value = sharedListId;
  showTab('join');
}

// Start
init();