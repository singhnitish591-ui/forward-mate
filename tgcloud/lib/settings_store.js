// tgcloud/lib/settings_store.js
// Forward Mate — Bot Settings Store (Singleton id = 1).
// Provides access to destination chat ID, forwarding enabled state, and dry-run mode.

import { db, eq, sql } from 'sdk/db';
import { botSettings } from '../schema.js';
import { DEFAULT_CONFIG } from './config.js';

const SETTINGS_SINGLETON_ID = 1;

/**
 * Retrieves the global bot settings singleton row.
 * Returns default configuration if the database row does not exist yet.
 *
 * @returns {Promise<object>}
 */
export async function getSettings() {
  const row = await db
    .select()
    .from(botSettings)
    .where(eq(botSettings.id, SETTINGS_SINGLETON_ID))
    .get();

  if (row) {
    return row;
  }

  return {
    id: SETTINGS_SINGLETON_ID,
    targetChatId: null,
    forwardingEnabled: DEFAULT_CONFIG.forwardingEnabled,
    dryRun: DEFAULT_CONFIG.dryRun,
    removeLinksGlobal: DEFAULT_CONFIG.removeLinksGlobal,
    createdAt: null,
    updatedAt: null,
  };
}

/**
 * Updates or initializes the singleton bot settings record.
 *
 * @param {object} patch Properties to update (targetChatId, forwardingEnabled, dryRun, removeLinksGlobal)
 * @returns {Promise<object>} Updated settings record
 */
export async function updateSettings(patch) {
  const existing = await db
    .select()
    .from(botSettings)
    .where(eq(botSettings.id, SETTINGS_SINGLETON_ID))
    .get();

  const timestamp = Math.floor(Date.now() / 1000);

  if (!existing) {
    await db
      .insert(botSettings)
      .values({
        id: SETTINGS_SINGLETON_ID,
        targetChatId: patch.targetChatId ?? null,
        forwardingEnabled: patch.forwardingEnabled ?? DEFAULT_CONFIG.forwardingEnabled,
        dryRun: patch.dryRun ?? DEFAULT_CONFIG.dryRun,
        removeLinksGlobal: patch.removeLinksGlobal ?? DEFAULT_CONFIG.removeLinksGlobal,
      })
      .run();
  } else {
    await db
      .update(botSettings)
      .set({
        ...patch,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(botSettings.id, SETTINGS_SINGLETON_ID))
      .run();
  }

  return await getSettings();
}
