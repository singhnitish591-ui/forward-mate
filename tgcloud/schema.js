// tgcloud/schema.js
// Forward Mate — Database Schema for Telegram Serverless SQLite (sdk/db).
//
// Rules from docs/tgcloud-sdk.md:
// 1. Tables are named exports.
// 2. NO foreignKey() or .references() — the platform runs with foreign keys disabled;
//    referential integrity is enforced in application code.
// 3. Drops happen only via .deprecated('reason').
// 4. Every DB operation at runtime must be awaited.

import { table, integer, text, boolean, index, uniqueIndex, sql } from 'sdk/db';

// ---------------------------------------------------------------------------
// 1. Source Channels Table
// Configured channels being monitored for channel_post updates.
// ---------------------------------------------------------------------------
export const sourceChannels = table('source_channels', {
  chatId: integer('chat_id').primaryKey(), // Telegram numeric chat ID (e.g. -100xxxxxxxxxx)
  username: text('username'), // Display username (without @, nullable)
  title: text('title'), // Last known channel title
  enabled: boolean('enabled').default(true), // Whether forwarding from this source is active
  removeLinks: boolean('remove_links').default(true), // Per-source URL cleaning override
  stripSignatures: boolean('strip_signatures').default(true), // Per-source signature stripping override
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// 2. Bot Settings Table (Singleton, id = 1)
// Global bot settings controlling destination channel and operating flags.
// ---------------------------------------------------------------------------
export const botSettings = table('bot_settings', {
  id: integer('id').primaryKey(), // Constant singleton ID (1)
  targetChatId: integer('target_chat_id'), // Destination numeric channel ID (e.g. -100xxxxxxxxxx)
  forwardingEnabled: boolean('forwarding_enabled').default(false), // Master switch (false until verified)
  dryRun: boolean('dry_run').default(true), // Safe default during development and initial testing
  removeLinksGlobal: boolean('remove_links_global').default(true), // Global link cleaning flag
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// 3. Strip Rules Table
// Literal signature strings and promotional lines to strip from posts.
// Arbitrary regex is disallowed to protect against catastrophic backtracking.
// ---------------------------------------------------------------------------
export const stripRules = table('strip_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pattern: text('pattern').notNull(), // Literal string to match and remove
  description: text('description'), // Optional human-readable note
  enabled: boolean('enabled').default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// 4. Processed Posts Table
// Tracks delivery state, retries, and prevents duplicate forwarding.
// ---------------------------------------------------------------------------
export const processedPosts = table(
  'processed_posts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceChatId: integer('source_chat_id').notNull(), // Source channel numeric ID
    sourceMessageId: integer('source_message_id').notNull(), // Source channel message ID
    status: text('status').notNull().default('processing'), // 'processing' | 'sent' | 'skipped' | 'failed'
    targetChatId: integer('target_chat_id'), // Published destination channel ID
    targetMessageId: integer('target_message_id'), // Published destination message ID
    attemptCount: integer('attempt_count').default(1),
    lastError: text('last_error'), // Short sanitized diagnostic / error code
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  },
  (t) => ({
    sourceMessageIdx: uniqueIndex('uidx_processed_posts_source').on(
      t.sourceChatId,
      t.sourceMessageId
    ),
    statusIdx: index('idx_processed_posts_status').on(t.status),
  })
);
