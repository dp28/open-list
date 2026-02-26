# Shopping List App - Requirements Document

## Overview
A simple, free, offline-capable shopping list for household use. Multiple users can contribute to the same list from multiple devices.

---

## Constraints

### Hosting & Cost
- **Must be free** - No hosting costs
- **Minimal setup** - Easy deployment process
- **Long-term stability** - Use providers likely to stay free (Cloudflare)
- **CI/CD from GitHub** - Deploy via GitHub Actions

### Maintenance
- **Minimal dependencies** - No framework churn, minimal upgrades
- **Zero production dependencies** - Vanilla JS only
- **Easy to maintain** - Simple codebase, well-understood technologies

### Technical Stack
- **Languages**: JavaScript, SQL (Cloudflare D1)
- **Runtime**: Node 22.x (for Wrangler CLI)
- **Database**: Cloudflare D1 (SQLite at edge)
- **Hosting**: Cloudflare Workers + Pages (or Worker assets)
- **CI/CD**: GitHub Actions

---

## Functional Requirements

### Core Features

#### Shopping List Management
- [x] Create multiple lists (each with unique ID and PIN)
- [x] Join existing lists via ID and PIN
- [x] Add items to list with text input
- [x] Mark items as complete/incomplete
- [x] Delete items
- [x] View all items in a list
- [x] Bulk delete all completed items with one click

#### Categories
- [x] Assign items to categories
- [x] Create new categories on-the-fly
- [x] Alphabetized dropdown of existing categories
- [x] Auto-suggest category based on past items
- [x] Group items by category in UI
- [x] Drag-and-drop reordering of categories
- [x] Persist category order locally and sync across devices
- [x] Default "Uncategorized" category for items without category
- [x] Delete categories (moves items to Uncategorized)
- [x] Category associations persisted in database

#### Offline Support
- [x] Works completely offline (add, complete, delete items)
- [x] Queue changes locally when offline
- [x] Auto-sync when connection restored
- [x] Background sync via Service Worker

#### Multi-User / Sharing
- [x] Multiple users can access same list via ID + PIN
- [x] Real-time sync between devices
- [x] Conflict resolution (server timestamp wins)
- [x] Share list via URL with embedded ID

### UI/UX Requirements

#### Mobile-First Design
- [x] Touch-friendly interface
- [x] Responsive layout (mobile and desktop)
- [x] Add to home screen support (PWA)
- [x] Works without zooming on mobile

#### Layout
- [x] Item input on separate line on mobile (stacked vertically)
- [x] Category dropdown on separate line on mobile
- [x] Add button full-width on mobile
- [x] Side-by-side layout on desktop (>600px)
- [x] Collapsible "Add New Item" section
- [x] Section state persisted locally

#### Visual Design
- [x] Clean, minimal interface
- [x] Green theme color (#4CAF50)
- [x] Clear visual hierarchy
- [x] Compact category grouping
- [x] Drag handles for reordering (⋮⋮)
- [x] Visual feedback for sync status

---

## Technical Requirements

### Frontend
- **Framework**: None (vanilla JavaScript)
- **Storage**: IndexedDB for offline storage
- **Sync**: Queue-based with timestamps
- **PWA**: Service Worker for offline support, manifest.json
- **Styling**: CSS with mobile-first media queries

### Backend
- **Runtime**: Cloudflare Workers (V8 isolates)
- **API**: RESTful endpoints
- **Authentication**: List ID + PIN in headers
- **CORS**: Enabled for all origins

### Database
- **Type**: Cloudflare D1 (SQLite)
- **Tables**:
  - `lists` - List metadata
  - `items` - Shopping items with category support
  - `categories` - Category definitions with sort order
- **Soft Deletes**: All records use deleted flag (no hard deletes)
- **Timestamps**: Server timestamps for conflict resolution

### Sync Protocol
- **Frequency**: Every 10 seconds when online
- **Strategy**: Last-write-wins (server timestamp)
- **Queue**: Pending changes stored in IndexedDB
- **Batching**: Send all pending changes in single request
- **Conflict Resolution**: Server time overrides client time

### Security
- **No user accounts** - Shared secret (PIN) per list
- **HTTPS only** - Enforced by Cloudflare
- **CORS headers** - Properly configured
- **No sensitive data** - Shopping items only

---

## Performance Requirements

- **Load time**: < 3 seconds on 3G
- **Sync time**: < 2 seconds
- **Offline capability**: 100% functionality without network
- **Storage**: Support for 1000+ items per list
- **Concurrent users**: Support 10+ simultaneous users per list

---

## Browser Support

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- iOS Safari (iOS 14+)
- Chrome for Android (latest)

---

## Best Practices for Adding New Features

### Implementation
- Implement features concisely and securely
- Follow coding best practices: KISS (Keep It Simple, Stupid), DRY (Don't Repeat Yourself)
- Think deeply about naming conventions and long-term extensibility without overcomplicating

### Quality Assurance
- Add automated tests for at least 95% code coverage
- Ensure all code passes linting checks
- Verify no existing features are broken

### Version Control
- Commit each feature as its own commit
- Commit messages should include:
  - Brief description of what changed
  - Slightly longer explanation of why it changed

### Documentation
- When completing a feature, move it from the Backlog section to the appropriate Requirements section
- Mark completed features with [x] in checklists

---

## Backlog

- Fix category reordering (drag and drop does not seem to work)
- Add dark mode
- Redesign to make UI more compact
- Add progressive web app install prompt
- Remember previous items (suggest completions when typing an item name based on previous items, and automatically select categories based on what that item had previously)
- Use Single Sign On with Google instead of a pin
- Stop showing the list id (move it to the URL)

---

## Change Log

### 2026-02-13
- Initial requirements documented
- Added category support requirements
- Added collapsible add section requirement
- Specified mobile-first responsive layout
- Documented offline sync strategy

### 2026-02-14
- Fixed category persistence bug (items now correctly associated with categories)
- Fixed overly broad error handling that was swallowing category data
- Added delete category functionality
- Category associations now properly saved to database

### 2026-02-14 (later)
- Added "Clear completed items" button to header
- Bulk deletes all completed items with confirmation
- Syncs deletions across devices

### 2026-02-14 (latest)
- **CRITICAL FIX**: Categories table was missing from database - created migration
- Fixed category sync between devices (categories now properly sync)
- Fixed category dropdown resetting during sync while user is creating new category
- Fixed category IDs not being sent with items in sync
- Added debugging to trace sync issues

---

## Notes

- Keep this document updated whenever requirements change
- Mark features as [x] when completed, [ ] when pending
- Update constraints section if hosting or technical decisions change
- Document any deviations from requirements in commit messages