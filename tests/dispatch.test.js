// tests/dispatch.test.js
// Unit tests for message dispatching rules and restrictions.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchMessage } from '../tgcloud/lib/message_dispatch.js';

describe('Message Dispatcher Logic (tgcloud/lib/message_dispatch.js)', () => {
  it('should reject dispatch if targetChatId is not provided', async () => {
    const result = await dispatchMessage({
      targetChatId: null,
      originalMessage: { chat: { id: -100123 }, text: 'Hello' },
      cleanedText: 'Hello',
    });

    assert.equal(result.success, false);
    assert.equal(result.reason, 'NO_TARGET_CHAT');
  });

  it('should skip protected content without attempting bypass', async () => {
    const originalMessage = {
      chat: { id: -100123 },
      message_id: 42,
      has_protected_content: true,
      text: 'Secret protected content',
    };

    const result = await dispatchMessage({
      targetChatId: -100999,
      originalMessage,
      cleanedText: 'Secret protected content',
    });

    assert.equal(result.success, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'PROTECTED_CONTENT');
  });

  it('should skip unsupported message types gracefully', async () => {
    const originalMessage = {
      chat: { id: -100123 },
      message_id: 55,
      poll: { question: 'What is your favorite color?' },
    };

    const result = await dispatchMessage({
      targetChatId: -100999,
      originalMessage,
      cleanedText: '',
    });

    assert.equal(result.success, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'UNSUPPORTED_MEDIA_TYPE');
  });
});
