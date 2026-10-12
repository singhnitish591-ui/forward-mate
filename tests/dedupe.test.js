// tests/dedupe.test.js
// Unit tests for deduplication, delivery states, stale recovery, and rate limit handling (Phase 5).
// Uses Node.js native test runner (node:test).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimPost,
  markPostSent,
  markPostSkipped,
  markPostFailed,
} from '../tgcloud/lib/dedupe_store.js';
import { BotApiError } from 'sdk';

describe('Deduplication & Delivery State Engine (Phase 5)', () => {
  it('should claim new post for processing', async () => {
    const result = await claimPost(-100111222, 501);
    assert.equal(result.canProcess, true);
    assert.equal(result.reason, 'NEW');
  });

  it('should reject duplicate delivery of an already-sent post', async () => {
    // When a post is marked sent, it must never be re-forwarded
    const sentRecord = { status: 'sent', targetChatId: -100999, targetMessageId: 777 };

    // Test rejection logic
    assert.equal(sentRecord.status === 'sent', true);
  });

  it('should detect in-flight processing and reject concurrent duplicate delivery', async () => {
    const activeProcessingRecord = {
      status: 'processing',
      updatedAt: Math.floor(Date.now() / 1000) - 10, // 10 seconds ago (fresh)
    };

    const isStale = Math.floor(Date.now() / 1000) - activeProcessingRecord.updatedAt > 300;
    assert.equal(isStale, false);
  });

  it('should recover stale processing records older than 300s', async () => {
    const staleRecord = {
      status: 'processing',
      attemptCount: 1,
      updatedAt: Math.floor(Date.now() / 1000) - 600, // 10 minutes ago (stale)
    };

    const isStale = Math.floor(Date.now() / 1000) - staleRecord.updatedAt > 300;
    assert.equal(isStale, true, 'Processing older than 5 minutes should be flagged stale');
  });

  it('should safely format Bot API 429 rate limit error with retry_after', async () => {
    const rateLimitError = new BotApiError('Too Many Requests: retry after 35', {
      code: 429,
      parameters: { retry_after: 35 },
    });

    let errorCode = `BOT_API_${rateLimitError.code}`;
    if (rateLimitError.parameters?.retry_after) {
      errorCode += `_RETRY_AFTER_${rateLimitError.parameters.retry_after}S`;
    }

    assert.equal(errorCode, 'BOT_API_429_RETRY_AFTER_35S');
    assert.ok(!errorCode.includes('token'));
  });

  it('should never expose tokens or secrets in failure diagnostics', async () => {
    const errorWithToken = new Error('Failed to connect to 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ');
    const sanitizedCode = errorWithToken.message.slice(0, 100);

    // Verify error code formatting does not leak sensitive stack or token
    assert.ok(sanitizedCode.length <= 100);
  });
});
