// tgcloud/lib/rules_store.js
// Forward Mate — Strip Rules Store.
// Manages configured literal signature strings to remove from posts.

import { db, eq } from 'sdk/db';
import { stripRules } from '../schema.js';

/**
 * Lists all active literal signature strip rules.
 *
 * @returns {Promise<Array<object>>}
 */
export async function listStripRules() {
  return await db.select().from(stripRules).all();
}

/**
 * Adds a new literal signature strip rule.
 *
 * @param {string} pattern Literal text pattern to remove
 * @param {string} [description]
 * @returns {Promise<object>}
 */
export async function addStripRule(pattern, description = null) {
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Pattern must be a non-empty string');
  }

  const result = await db
    .insert(stripRules)
    .values({
      pattern: pattern.trim(),
      description,
      enabled: true,
    })
    .returning()
    .run();

  return result[0];
}

/**
 * Deletes a strip rule by its numeric ID.
 *
 * @param {number|string} ruleId
 * @returns {Promise<boolean>}
 */
export async function deleteStripRule(ruleId) {
  const id = Number(ruleId);
  const result = await db.delete(stripRules).where(eq(stripRules.id, id)).run();
  return (result.rowsAffected ?? 0) > 0;
}
