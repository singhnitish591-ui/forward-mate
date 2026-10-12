// tests/auth.test.js
// Tests for Forward Mate owner authentication and chat-type guards.
// Uses Node.js native test runner (node:test).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateChat, isOwner, authenticateOwnerCommand } from '../tgcloud/lib/auth.js';
import * as config from '../tgcloud/lib/config.js';

describe('Authentication Guards (tgcloud/lib/auth.js)', () => {
  describe('isPrivateChat', () => {
    it('should return true for private chat type', () => {
      const msg = { chat: { id: 12345, type: 'private' } };
      assert.equal(isPrivateChat(msg), true);
    });

    it('should return false for group chat type', () => {
      const msg = { chat: { id: -100123, type: 'group' } };
      assert.equal(isPrivateChat(msg), false);
    });

    it('should return false for supergroup chat type', () => {
      const msg = { chat: { id: -100456, type: 'supergroup' } };
      assert.equal(isPrivateChat(msg), false);
    });

    it('should return false for channel chat type', () => {
      const msg = { chat: { id: -100789, type: 'channel' } };
      assert.equal(isPrivateChat(msg), false);
    });

    it('should return false for null or malformed message', () => {
      assert.equal(isPrivateChat(null), false);
      assert.equal(isPrivateChat({}), false);
      assert.equal(isPrivateChat({ chat: null }), false);
    });
  });

  describe('isOwner & authenticateOwnerCommand with username and numeric ID', () => {
    it('should recognize configured username @Rkumar045 regardless of casing', () => {
      assert.equal(isOwner({ id: 111, username: 'Rkumar045' }), true);
      assert.equal(isOwner({ id: 111, username: 'rkumar045' }), true);
      assert.equal(isOwner({ id: 111, username: '@Rkumar045' }), true);
      assert.equal(isOwner('Rkumar045'), true);
      assert.equal(isOwner('@rkumar045'), true);
    });

    it('should reject non-allowlisted username', () => {
      assert.equal(isOwner({ id: 111, username: 'stranger_user' }), false);
      assert.equal(isOwner('someone_else'), false);
    });

    it('should authorize owner command from @Rkumar045 in private chat', () => {
      const ownerMsg = {
        chat: { id: 123456, type: 'private' },
        from: { id: 123456, username: 'Rkumar045' },
        text: '/status',
      };
      const result = authenticateOwnerCommand(ownerMsg);
      assert.equal(result.authorized, true);
      assert.equal(result.username, 'Rkumar045');
    });

    it('should reject owner command if sent in a group chat', () => {
      const groupMsg = {
        chat: { id: -100123456, type: 'supergroup' },
        from: { id: 123456, username: 'Rkumar045' },
        text: '/status',
      };
      const result = authenticateOwnerCommand(groupMsg);
      assert.equal(result.authorized, false);
      assert.equal(result.reason, 'NOT_PRIVATE_CHAT');
    });

    it('should reject non-owner command in private chat', () => {
      const nonOwnerMsg = {
        chat: { id: 999999, type: 'private' },
        from: { id: 999999, username: 'unauthorized_guy' },
        text: '/settarget @hack',
      };
      const result = authenticateOwnerCommand(nonOwnerMsg);
      assert.equal(result.authorized, false);
      assert.equal(result.reason, 'UNAUTHORIZED_USER');
    });
  });
});
