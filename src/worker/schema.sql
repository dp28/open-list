-- Migration to add categories support
-- This handles both new and existing databases

-- Create categories table if not exists
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
);

-- Check if we need to migrate the items table
-- D1 uses SQLite which has limited ALTER TABLE support
-- We'll create the new schema and the application will handle missing columns gracefully

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_categories_list ON categories(list_id);
CREATE INDEX IF NOT EXISTS idx_categories_order ON categories(list_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_items_list ON items(list_id);
CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at);