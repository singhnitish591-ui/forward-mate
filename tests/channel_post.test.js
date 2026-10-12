// tests/channel_post.test.js
// Unit tests for channel_post update handling and dispatch rules (Phase 4).
// Uses Node.js native test runner (node:test).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchMessage } from '../tgcloud/lib/message_dispatch.js';
import channelPostHandler from '../tgcloud/handlers/channel_post.js';

describe('Channel Post Handling & Routing (Phase 4)', () => {
  describe('Ignored & Paused States', () => {
    it('should ignore post from unconfigured channel', async () => {
      // Mock unconfigured channel post (-100999888 is not in source_channels)
      const post = {
        message_id: 1,
        chat: { id: -100999888, type: 'channel' },
        text: 'Hello from unknown channel',
      };

      const result = await channelPostHandler(post, {});
      assert.equal(result, undefined);
    });

    it('should ignore post if message or chat is missing', async () => {
      assert.equal(await channelPostHandler(null, {}), undefined);
      assert.equal(await channelPostHandler({}, {}), undefined);
      assert.equal(await channelPostHandler({ chat: null }, {}), undefined);
    });
  });

  describe('Supported Media Types Dispatching', () => {
    const targetChatId = -100555666;

    it('should send photo with cleaned caption', async () => {
      const msg = {
        message_id: 10,
        chat: { id: -100111, type: 'channel' },
        photo: [
          { file_id: 'thumb_id', width: 100, height: 100 },
          { file_id: 'highres_id', width: 1200, height: 800 },
        ],
        caption: 'Look at this photo: https://badlink.com! Use code: PHOTO20',
      };

      const result = await dispatchMessage({
        targetChatId,
        originalMessage: msg,
        cleanedText: 'Look at this photo: ! Use code: PHOTO20',
      });

      assert.equal(result.success, true);
      assert.equal(result.targetMessageId, 12345);
    });

    it('should send video with cleaned caption', async () => {
      const msg = {
        message_id: 11,
        chat: { id: -100111, type: 'channel' },
        video: { file_id: 'video_file_id', duration: 60 },
        caption: 'Watch video: https://spam.com Code: VID10',
      };

      const result = await dispatchMessage({
        targetChatId,
        originalMessage: msg,
        cleanedText: 'Watch video: Code: VID10',
      });

      assert.equal(result.success, true);
    });

    it('should send document with cleaned caption', async () => {
      const msg = {
        message_id: 12,
        chat: { id: -100111, type: 'channel' },
        document: { file_id: 'doc_file_id', file_name: 'test.pdf' },
        caption: 'PDF download https://promo.com Code: DOC20',
      };

      const result = await dispatchMessage({
        targetChatId,
        originalMessage: msg,
        cleanedText: 'PDF download Code: DOC20',
      });

      assert.equal(result.success, true);
    });

    it('should send animation (GIF) with cleaned caption', async () => {
      const msg = {
        message_id: 13,
        chat: { id: -100111, type: 'channel' },
        animation: { file_id: 'anim_file_id' },
        caption: 'Funny GIF https://giflink.com',
      };

      const result = await dispatchMessage({
        targetChatId,
        originalMessage: msg,
        cleanedText: 'Funny GIF',
      });

      assert.equal(result.success, true);
    });

    it('should send audio with cleaned caption', async () => {
      const msg = {
        message_id: 14,
        chat: { id: -100111, type: 'channel' },
        audio: { file_id: 'audio_file_id', title: 'Podcast' },
        caption: 'Episode 1 https://listen.com',
      };

      const result = await dispatchMessage({
        targetChatId,
        originalMessage: msg,
        cleanedText: 'Episode 1',
      });

      assert.equal(result.success, true);
    });

    it('should copy sticker without attribution', async () => {
      const msg = {
        message_id: 15,
        chat: { id: -100111, type: 'channel' },
        sticker: { file_id: 'sticker_file_id' },
      };

      const result = await dispatchMessage({
        targetChatId,
        originalMessage: msg,
        cleanedText: '',
      });

      assert.equal(result.success, true);
    });
  });

  describe('Restrictions & Protected Content', () => {
    it('should not forward protected content and return skipped status', async () => {
      const msg = {
        message_id: 16,
        chat: { id: -100111, type: 'channel' },
        has_protected_content: true,
        text: 'This post has protection enabled',
      };

      const result = await dispatchMessage({
        targetChatId: -100555666,
        originalMessage: msg,
        cleanedText: 'This post has protection enabled',
      });

      assert.equal(result.success, false);
      assert.equal(result.skipped, true);
      assert.equal(result.reason, 'PROTECTED_CONTENT');
    });

    it('should skip unsupported types (e.g. polls, dice, contacts)', async () => {
      const msg = {
        message_id: 17,
        chat: { id: -100111, type: 'channel' },
        poll: { question: 'Poll question' },
      };

      const result = await dispatchMessage({
        targetChatId: -100555666,
        originalMessage: msg,
        cleanedText: '',
      });

      assert.equal(result.success, false);
      assert.equal(result.skipped, true);
      assert.equal(result.reason, 'UNSUPPORTED_MEDIA_TYPE');
    });
  });
});
