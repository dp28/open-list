# Shopping List App

A simple, free, offline-capable shopping list for your household.

## Features

- **Google Sign-in**: Sign in with Google to create and manage lists
- **Private by default**: Lists are private, share with specific people
- **Works offline**: Changes saved locally, sync when online
- **Shared**: Collaborate on lists with family members
- **Smart suggestions**: Remembers your items and suggests completions
- **Mobile-first**: PWA with install prompt
- **Dark mode**: System, light, or dark theme
- **Zero dependencies**: Vanilla JS, no framework churn
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

### 5. Set up Google OAuth
1. Go to https://console.cloudflare.com/
2. Create a new OAuth application:
   - App name: "Shopping List"
   - Redirect URIs: `https://your-worker.workers.dev/auth/callback`
3. Add secrets:
   ```bash
   echo "YOUR_CLIENT_ID" | wrangler secret put GOOGLE_OAUTH_CLIENT_ID
   echo "YOUR_CLIENT_SECRET" | wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
   ```

### 6. Deploy
```bash
wrangler deploy
```

Your app will be live at `https://shopping-list-api.YOUR_SUBDOMAIN.workers.dev`

### 7. Set GitHub secrets (for auto-deploy)
In your GitHub repo settings, add:
- `CLOUDFLARE_API_TOKEN` (create at https://dash.cloudflare.com/profile/api-tokens with "Edit Cloudflare Workers" permission)
- `CLOUDFLARE_ACCOUNT_ID` (find in Cloudflare dashboard sidebar)

## Usage

### Getting Started
1. Open the deployed URL
2. Sign in with Google
3. Create your first list
4. Add items

### Sharing Lists
1. Tap the share button on a list
2. Enter the email of the person you want to share with
3. They must sign in with Google first
4. They'll see the list in their "Your Lists" section

### Smart Suggestions
- When typing an item name, suggestions appear below
- Suggestions show previous items you've added
- Categories are auto-suggested based on previous items with the same name
- Incomplete items appear before completed ones

### Offline Mode
- Works completely offline
- Changes sync automatically when back online
- "Add to Home Screen" for the best experience

## Architecture

- **Frontend**: Vanilla JS PWA with IndexedDB for offline storage
- **Backend**: Cloudflare Worker serves API + static files
- **Database**: Cloudflare D1 (SQLite at edge)
- **Authentication**: Google OAuth 2.0 (implicit flow)
- **Sync**: Queue-based with timestamp conflict resolution

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
