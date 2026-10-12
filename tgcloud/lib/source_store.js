// tgcloud/lib/source_store.js
// Forward Mate — Source Channels Store.
// Manages configured channels being monitored for channel_post updates.

import { db, eq, sql } from 'sdk/db';
import { sourceChannels } from '../schema.js';

/**
 * Retrieves a source channel record by its numeric Telegram chat ID.
 *
 * @param {number|string} chatId
 * @returns {Promise<object|null>}
 */
export async function getSourceChannel(chatId) {
  if (!chatId) return null;
  const numericId = Number(chatId);
  return await db
    .select()
    .from(sourceChannels)
    .where(eq(sourceChannels.chatId, numericId))
    .get();
}

/**
 * Lists all configured source channels.
 *
 * @returns {Promise<Array<object>>}
 */
export async function listSourceChannels() {
  return await db.select().from(sourceChannels).all();
}

/**
 * Adds or updates a monitored source channel.
 *
 * @param {object} channelData
 * @param {number} channelData.chatId Numeric chat ID
 * @param {string} [channelData.username] Display username
 * @param {string} [channelData.title] Channel title
 * @param {boolean} [channelData.enabled=true]
 * @param {boolean} [channelData.removeLinks=true]
 * @param {boolean} [channelData.stripSignatures=true]
 * @returns {Promise<object>}
 */
export async function upsertSourceChannel({
  chatId,
  username = null,
  title = null,
  enabled = true,
  removeLinks = true,
  stripSignatures = true,
}) {
  const numericId = Number(chatId);
  const existing = await getSourceChannel(numericId);

  if (!existing) {
    await db
      .insert(sourceChannels)
      .values({
        chatId: numericId,
        username: username ? username.replace(/^@/, '') : null,
        title,
        enabled,
        removeLinks,
        stripSignatures,
      })
      .run();
  } else {
    await db
      .update(sourceChannels)
      .set({
        username: username ? username.replace(/^@/, '') : existing.username,
        title: title ?? existing.title,
        enabled: enabled ?? existing.enabled,
        removeLinks: removeLinks ?? existing.removeLinks,
        stripSignatures: stripSignatures ?? existing.stripSignatures,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(sourceChannels.chatId, numericId))
      .run();
  }

  return await getSourceChannel(numericId);
}

/**
 * Removes (deletes) a monitored source channel.
 *
 * @param {number|string} chatId
 * @returns {Promise<boolean>}
 */
export async function removeSourceChannel(chatId) {
  const numericId = Number(chatId);
  const result = await db
    .delete(sourceChannels)
    .where(eq(sourceChannels.chatId, numericId))
    .run();
  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Toggles enabled status of a monitored source channel.
 *
 * @param {number|string} chatId
 * @param {boolean} enabled
 * @returns {Promise<object|null>}
 */
export async function setSourceEnabled(chatId, enabled) {
  const numericId = Number(chatId);
  await db
    .update(sourceChannels)
    .set({
      enabled,
      updatedAt: sql`(unixepoch())`,
    })
    .where(eq(sourceChannels.chatId, numericId))
    .run();

  return await getSourceChannel(numericId);
}
