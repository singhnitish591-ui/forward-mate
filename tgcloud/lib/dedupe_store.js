// tgcloud/lib/dedupe_store.js
// Forward Mate — Deduplication & Delivery State Engine.
//
// State Lifecycle:
// [Incoming Post] -> 'processing' (claimed)
//                    ├── Successfully dispatched -> 'sent' (terminal; NEVER re-sent)
//                    ├── Filtered/Empty/Protected -> 'skipped' (terminal)
//                    └── Dispatch error/429 -> 'failed' (can be inspected or retried)
//
// Unavoidable Edge Case Note:
// Exactly-once delivery is impossible in distributed systems if Telegram accepts the message
// but the isolate fails before SQLite records the 'sent' state. We record 'processing' prior
// to dispatch to detect retries, recover stale processing (>5 min), and prevent duplicate deliveries.

import { db, eq, and, sql } from 'sdk/db';
import { processedPosts } from '../schema.js';
import { logger } from './logger.js';

// Consider processing claims older than 5 minutes as stale (e.g., isolate crashed or timed out)
const STALE_PROCESSING_THRESHOLD_SEC = 300;

/**
 * Claims a message for processing or detects duplicate/in-progress delivery.
 *
 * @param {number|string} sourceChatId
 * @param {number|string} sourceMessageId
 * @returns {Promise<{
 *   canProcess: boolean,
 *   reason?: 'NEW' | 'STALE_PROCESSING' | 'RETRY_FAILED' | 'ALREADY_SENT' | 'ALREADY_SKIPPED' | 'CURRENTLY_PROCESSING',
 *   record?: object
 * }>}
 */
export async function claimPost(sourceChatId, sourceMessageId) {
  const sChatId = Number(sourceChatId);
  const sMsgId = Number(sourceMessageId);

  const existing = await db
    .select()
    .from(processedPosts)
    .where(
      and(
        eq(processedPosts.sourceChatId, sChatId),
        eq(processedPosts.sourceMessageId, sMsgId)
      )
    )
    .get();

  const nowSec = Math.floor(Date.now() / 1000);

  if (!existing) {
    // Brand new post — record initial 'processing' claim
    await db
      .insert(processedPosts)
      .values({
        sourceChatId: sChatId,
        sourceMessageId: sMsgId,
        status: 'processing',
        attemptCount: 1,
      })
      .run();

    return { canProcess: true, reason: 'NEW' };
  }

  // If already published to destination channel, NEVER send again
  if (existing.status === 'sent') {
    return { canProcess: false, reason: 'ALREADY_SENT', record: existing };
  }

  // If already evaluated and skipped (e.g. empty or protected), do not send
  if (existing.status === 'skipped') {
    return { canProcess: false, reason: 'ALREADY_SKIPPED', record: existing };
  }

  // If currently in 'processing' status
  if (existing.status === 'processing') {
    const updatedAt = existing.updatedAt instanceof Date
      ? Math.floor(existing.updatedAt.getTime() / 1000)
      : Number(existing.updatedAt || nowSec);

    const isStale = nowSec - updatedAt > STALE_PROCESSING_THRESHOLD_SEC;

    if (isStale) {
      // Stale processing recovery
      await db
        .update(processedPosts)
        .set({
          attemptCount: (existing.attemptCount || 1) + 1,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(processedPosts.id, existing.id))
        .run();

      logger.warn('Recovered stale processing record for post retry', {
        sourceChatId: sChatId,
        sourceMessageId: sMsgId,
        attempt: (existing.attemptCount || 1) + 1,
      });

      return { canProcess: true, reason: 'STALE_PROCESSING', record: existing };
    }

    // Active in-flight processing; drop duplicate update delivery
    return { canProcess: false, reason: 'CURRENTLY_PROCESSING', record: existing };
  }

  // If in 'failed' status, can be retried
  return { canProcess: true, reason: 'RETRY_FAILED', record: existing };
}

/**
 * Marks a post as successfully sent to the destination.
 *
 * @param {number|string} sourceChatId
 * @param {number|string} sourceMessageId
 * @param {object} dispatchResult
 * @param {number} [dispatchResult.targetChatId]
 * @param {number} [dispatchResult.targetMessageId]
 */
export async function markPostSent(sourceChatId, sourceMessageId, { targetChatId, targetMessageId }) {
  await db
    .update(processedPosts)
    .set({
      status: 'sent',
      targetChatId: targetChatId ? Number(targetChatId) : null,
      targetMessageId: targetMessageId ? Number(targetMessageId) : null,
      lastError: null,
      updatedAt: sql`(unixepoch())`,
    })
    .where(
      and(
        eq(processedPosts.sourceChatId, Number(sourceChatId)),
        eq(processedPosts.sourceMessageId, Number(sourceMessageId))
      )
    )
    .run();
}

/**
 * Marks a post as skipped (e.g. empty after cleaning, protected content).
 *
 * @param {number|string} sourceChatId
 * @param {number|string} sourceMessageId
 * @param {string} reason
 */
export async function markPostSkipped(sourceChatId, sourceMessageId, reason) {
  await db
    .update(processedPosts)
    .set({
      status: 'skipped',
      lastError: reason || 'SKIPPED',
      updatedAt: sql`(unixepoch())`,
    })
    .where(
      and(
        eq(processedPosts.sourceChatId, Number(sourceChatId)),
        eq(processedPosts.sourceMessageId, Number(sourceMessageId))
      )
    )
    .run();
}

/**
 * Marks a post as failed with structured, secret-safe diagnostic information.
 *
 * @param {number|string} sourceChatId
 * @param {number|string} sourceMessageId
 * @param {any} error
 */
export async function markPostFailed(sourceChatId, sourceMessageId, error) {
  let errorCode = 'UNKNOWN_ERROR';
  if (error?.code) {
    errorCode = `BOT_API_${error.code}`;
    if (error.parameters?.retry_after) {
      errorCode += `_RETRY_AFTER_${error.parameters.retry_after}S`;
    }
  } else if (error?.message) {
    errorCode = error.message.slice(0, 100);
  }

  await db
    .update(processedPosts)
    .set({
      status: 'failed',
      lastError: errorCode,
      updatedAt: sql`(unixepoch())`,
    })
    .where(
      and(
        eq(processedPosts.sourceChatId, Number(sourceChatId)),
        eq(processedPosts.sourceMessageId, Number(sourceMessageId))
      )
    )
    .run();
}

/**
 * Retrieves recently failed posts for owner diagnostics.
 *
 * @param {number} [limit=10]
 * @returns {Promise<Array<object>>}
 */
export async function getRecentFailedPosts(limit = 10) {
  return await db
    .select()
    .from(processedPosts)
    .where(eq(processedPosts.status, 'failed'))
    .all();
}
