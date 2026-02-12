# Shopping List App

A simple, free, offline-capable shopping list for your household.

## Features

- **Free hosting**: Cloudflare Workers + D1 (no Pages needed!)
- **Works offline**: Changes saved locally, sync when online
- **Shared**: Multiple users can access the same list
- **Mobile-first**: PWA with add-to-homescreen support
- **Zero dependencies**: No npm packages, no framework churn
- **Single deployment**: Worker serves both API and static files

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
Copy the database ID into `wrangler.toml` (replace `YOUR_DATABASE_ID_HERE`)

### 4. Initialize database schema
```bash
wrangler d1 execute shopping-list-db --remote --file=src/worker/schema.sql
```

### 5. Deploy
```bash
wrangler deploy
```

Your app will be live at `https://shopping-list-api.YOUR_SUBDOMAIN.workers.dev`

### 6. Set GitHub secrets (for auto-deploy)
In your GitHub repo settings, add:
- `CLOUDFLARE_API_TOKEN` (create at https://dash.cloudflare.com/profile/api-tokens with "Edit Cloudflare Workers" permission)
- `CLOUDFLARE_ACCOUNT_ID` (find in Cloudflare dashboard sidebar)

## Architecture

- **Frontend**: Vanilla JS PWA with IndexedDB for offline storage
- **Backend**: Cloudflare Worker serves API + static files
- **Database**: Cloudflare D1 (SQLite at edge)
- **Sync**: Queue-based with timestamp conflict resolution

## Usage

1. Open the deployed URL on your phone
2. Create a list with a name and PIN
3. Share the list ID and PIN with household members
4. Add items - they sync automatically when online
5. Check items off in the supermarket (works offline!)
6. "Add to Home Screen" for app-like experience

## Development

```bash
# Local development
wrangler dev

# Database operations
wrangler d1 execute shopping-list-db --remote --file=src/worker/schema.sql
```

## Maintenance

- **Updates**: Push to main branch, auto-deploys via GitHub Actions
- **Backups**: `wrangler d1 export shopping-list-db --remote --output=backup.sql`
- **Monitoring**: Cloudflare dashboard > Workers & Pages > shopping-list-api