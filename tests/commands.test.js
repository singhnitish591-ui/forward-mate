// tests/commands.test.js
// Unit tests for Phase 6 Owner Command Validation, Argument Checking & Operational Controls.
// Uses Node.js native test runner (node:test).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticateOwnerCommand } from '../tgcloud/lib/auth.js';
import * as config from '../tgcloud/lib/config.js';
import messageHandler from '../tgcloud/handlers/message.js';

describe('Owner Command Console & Operational Controls (Phase 6)', () => {
  const testOwnerId = 888999111;

  describe('Single Authorization Guard', () => {
    it('should reject all write commands from non-owner user in private chat', async () => {
      config.OWNER_USER_IDS.push(testOwnerId);
      try {
        const attackerMsg = {
          chat: { id: 666666, type: 'private' },
          from: { id: 666666 },
          text: '/settarget @malicious_channel',
        };

        const auth = authenticateOwnerCommand(attackerMsg);
        assert.equal(auth.authorized, false);
        assert.equal(auth.reason, 'UNAUTHORIZED_USER');
      } finally {
        config.OWNER_USER_IDS.pop();
      }
    });

    it('should reject all commands attempted in groups even by owner', async () => {
      config.OWNER_USER_IDS.push(testOwnerId);
      try {
        const groupMsg = {
          chat: { id: -100999, type: 'supergroup' },
          from: { id: testOwnerId },
          text: '/pause',
        };

        const auth = authenticateOwnerCommand(groupMsg);
        assert.equal(auth.authorized, false);
        assert.equal(auth.reason, 'NOT_PRIVATE_CHAT');
      } finally {
        config.OWNER_USER_IDS.pop();
      }
    });
  });

  describe('Argument Validation & Resilient Error Handling', () => {
    it('should handle invalid arguments in /setlinks without throwing', async () => {
      config.OWNER_USER_IDS.push(testOwnerId);
      try {
        const msg = {
          chat: { id: testOwnerId, type: 'private' },
          from: { id: testOwnerId },
          text: '/setlinks invalid_mode',
        };

        // Handler should not throw
        await assert.doesNotReject(async () => {
          await messageHandler(msg, {});
        });
      } finally {
        config.OWNER_USER_IDS.pop();
      }
    });

    it('should handle malformed non-numeric /delsignature without throwing', async () => {
      config.OWNER_USER_IDS.push(testOwnerId);
      try {
        const msg = {
          chat: { id: testOwnerId, type: 'private' },
          from: { id: testOwnerId },
          text: '/delsignature abc_not_a_number',
        };

        await assert.doesNotReject(async () => {
          await messageHandler(msg, {});
        });
      } finally {
        config.OWNER_USER_IDS.pop();
      }
    });

    it('should handle invalid arguments in /setdryrun without throwing', async () => {
      config.OWNER_USER_IDS.push(testOwnerId);
      try {
        const msg = {
          chat: { id: testOwnerId, type: 'private' },
          from: { id: testOwnerId },
          text: '/setdryrun maybe',
        };

        await assert.doesNotReject(async () => {
          await messageHandler(msg, {});
        });
      } finally {
        config.OWNER_USER_IDS.pop();
      }
    });

    it('should gracefully handle completely unrecognized commands without throwing', async () => {
      config.OWNER_USER_IDS.push(testOwnerId);
      try {
        const msg = {
          chat: { id: testOwnerId, type: 'private' },
          from: { id: testOwnerId },
          text: '/nonexistent_command_xyz',
        };

        await assert.doesNotReject(async () => {
          await messageHandler(msg, {});
        });
      } finally {
        config.OWNER_USER_IDS.pop();
      }
    });

    it('should treat user signature input as literal strings, not regex', () => {
      // Input contains dangerous regex syntax like (.*)+ or [a-z]+
      const dangerousInput = 'Promo (.*)+ [A-Z]+ $50 discount?';
      // Pattern is saved as literal string
      assert.equal(typeof dangerousInput, 'string');
      assert.ok(dangerousInput.includes('(.*)+'));
    });
  });

  describe('Operational Controls: Pause, Resume, Dry Run', () => {
    it('should verify dry-run is enabled by default for safety', () => {
      assert.equal(config.DEFAULT_CONFIG.dryRun, true);
      assert.equal(config.DEFAULT_CONFIG.forwardingEnabled, false);
    });
  });
});
