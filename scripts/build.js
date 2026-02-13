#!/usr/bin/env node
// Build script to inject cache-busting version into service worker
// Run this before deployment to ensure clients get the latest version

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CLIENT_DIR = path.join(__dirname, '..', 'src', 'client');
const SW_FILE = path.join(CLIENT_DIR, 'sw.js');

// Generate a unique version based on timestamp and content hash
function generateVersion() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

// Read the service worker file
function readServiceWorker() {
  return fs.readFileSync(SW_FILE, 'utf-8');
}

// Update the service worker with the new version
function updateServiceWorker(version) {
  let content = readServiceWorker();
  
  // Replace the CACHE_NAME definition
  // Look for: const CACHE_NAME = 'shopping-list-v1'; or const CACHE_NAME = 'shopping-list-<hash>';
  const oldCacheNamePattern = /const CACHE_NAME = ['"]shopping-list-[^'"]*['"];/;
  const newCacheName = `const CACHE_NAME = 'shopping-list-${version}';`;
  
  if (oldCacheNamePattern.test(content)) {
    content = content.replace(oldCacheNamePattern, newCacheName);
    console.log(`✓ Updated CACHE_NAME to: shopping-list-${version}`);
  } else {
    console.error('✗ Could not find CACHE_NAME definition in sw.js');
    process.exit(1);
  }
  
  fs.writeFileSync(SW_FILE, content, 'utf-8');
}

// Create a version.json file that the app can check
function createVersionFile(version) {
  const versionFile = path.join(CLIENT_DIR, 'version.json');
  const versionData = {
    version: version,
    buildTime: new Date().toISOString()
  };
  
  fs.writeFileSync(versionFile, JSON.stringify(versionData, null, 2), 'utf-8');
  console.log(`✓ Created version.json with version: ${version}`);
}

// Main build process
function build() {
  console.log('🔨 Building shopping list app with cache busting...\n');
  
  const version = generateVersion();
  console.log(`Generated version: ${version}\n`);
  
  // Update service worker
  updateServiceWorker(version);
  
  // Create version.json for the app to check
  createVersionFile(version);
  
  console.log('\n✅ Build complete!');
  console.log(`Version ${version} will bust caches on deploy.`);
}

build();
