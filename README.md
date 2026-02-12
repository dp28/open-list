# Shopping List App

A simple, free, offline-capable shopping list for your household.

## Features

- **Free hosting**: Cloudflare Workers + D1 + Pages
- **Works offline**: Changes saved locally, sync when online
- **Shared**: Multiple users can access the same list
- **Mobile-first**: PWA with add-to-homescreen support
- **Zero dependencies**: No npm packages, no framework churn

## Setup

### 1. Create Cloudflare account
Sign up at https://cloudflare.com (free)

### 2. Install Wrangler CLI
```bash
npm install -g wrangler
wrangler login
```

### 3. Create D1 database
```bash
wrangler d1 create shopping-list-db
```
Copy the database ID into `wrangler.toml`

### 4. Initialize database schema
```bash
wrangler d1 execute shopping-list-db --file=src/worker/schema.sql
```

### 5. Deploy Worker
```bash
wrangler deploy src/worker/index.js --name shopping-list-api
```

### 6. Create Pages project
In Cloudflare dashboard:
1. Go to Pages > Create project
2. Connect your GitHub repo
3. Build command: `cp src/client/* dist/`
4. Output directory: `dist`

### 7. Set GitHub secrets
In your GitHub repo settings, add:
- `CLOUDFLARE_API_TOKEN` (create at https://dash.cloudflare.com/profile/api-tokens)
- `CLOUDFLARE_ACCOUNT_ID` (find in Cloudflare dashboard sidebar)

## Architecture

- **Frontend**: Vanilla JS PWA with IndexedDB for offline storage
- **Backend**: Cloudflare Worker with REST API
- **Database**: Cloudflare D1 (SQLite at edge)
- **Sync**: Queue-based with timestamp conflict resolution

## Usage

1. Create a list with a name and PIN
2. Share the list ID and PIN with household members
3. Add items - they sync automatically when online
4. Check items off in the supermarket (works offline!)

## Maintenance

- Updates: Push to main branch, auto-deploys via GitHub Actions
- Backups: D1 database can be exported via Wrangler
- Monitoring: Cloudflare dashboard shows request metrics