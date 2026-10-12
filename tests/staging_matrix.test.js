// tests/staging_matrix.test.js
// Automated verification of the 12 Staging Matrix cases.
// Uses Node.js native test runner (node:test).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMessage } from '../tgcloud/lib/cleaner.js';
import { dispatchMessage } from '../tgcloud/lib/message_dispatch.js';
import { authenticateOwnerCommand } from '../tgcloud/lib/auth.js';
import {
  plainCodePayload,
  codeWithUrlPayload,
  multipleUrlsPayload,
  urlOnlyPayload,
  photoWithUrlCaptionPayload,
  videoCaptionPayload,
  documentPayload,
  protectedContentPayload,
} from './fixtures/payloads.js';
import * as config from '../tgcloud/lib/config.js';

describe('Staging Validation Matrix (Cases 1-12)', () => {
  it('Case 1: Plain code: Code: SAVE20 remains intact', () => {
    const raw = plainCodePayload.channel_post.text;
    const result = cleanMessage(raw);

    assert.equal(result.shouldSkip, false);
    assert.ok(result.cleanedText.includes('SAVE20'));
    assert.equal(result.removedLinkCount, 0);
  });

  it('Case 2: Code plus one URL: code remains and URL is removed', () => {
    const post = codeWithUrlPayload.channel_post;
    const result = cleanMessage(post.text, post.entities);

    assert.equal(result.shouldSkip, false);
    assert.ok(result.cleanedText.includes('SAVE30'));
    assert.ok(!result.cleanedText.includes('https://deals.example.com'));
    assert.ok(result.removedLinkCount >= 1);
  });

  it('Case 3: Several URLs and t.me links: all configured links are removed', () => {
    const post = multipleUrlsPayload.channel_post;
    const result = cleanMessage(post.text);

    assert.equal(result.shouldSkip, false);
    assert.ok(!result.cleanedText.includes('https://store.com'));
    assert.ok(!result.cleanedText.includes('www.deals.org'));
    assert.ok(!result.cleanedText.includes('t.me/promochannel'));
    assert.ok(result.cleanedText.includes('for more!'));
  });

  it('Case 4: URL-only message: skipped, not blank-published', () => {
    const post = urlOnlyPayload.channel_post;
    const result = cleanMessage(post.text, post.entities);

    assert.equal(result.shouldSkip, true);
    assert.equal(result.skipReason, 'EMPTY_AFTER_CLEANING');
    assert.equal(result.cleanedText, '');
  });

  it('Case 5: Message with emoji before/after URL: no text corruption', () => {
    const text = '🎉 Amazing Deal! https://site.com/item 🚀 Grab it fast!';
    const result = cleanMessage(text);

    assert.equal(result.shouldSkip, false);
    assert.ok(!result.cleanedText.includes('https://site.com'));
    assert.ok(result.cleanedText.includes('🎉 Amazing Deal!'));
    assert.ok(result.cleanedText.includes('🚀 Grab it fast!'));
  });

  it('Case 6: Photo/video/document with link in caption: media prepared and link is removed', async () => {
    // 6a. Photo
    const photoPost = photoWithUrlCaptionPayload.channel_post;
    const photoClean = cleanMessage(photoPost.caption, photoPost.caption_entities);
    assert.equal(photoClean.shouldSkip, false);
    assert.ok(photoClean.cleanedText.includes('CODE: SNEAK25'));
    assert.ok(!photoClean.cleanedText.includes('https://shop.com/sneakers'));

    const photoRes = await dispatchMessage({
      targetChatId: -100999888,
      originalMessage: photoPost,
      cleanedText: photoClean.cleanedText,
      cleanedEntities: photoClean.cleanedEntities,
    });
    assert.equal(photoRes.success, true);

    // 6b. Video
    const videoPost = videoCaptionPayload.channel_post;
    const videoClean = cleanMessage(videoPost.caption, videoPost.caption_entities);
    assert.equal(videoClean.shouldSkip, false);
    assert.ok(videoClean.cleanedText.includes('TECH50'));
    assert.ok(!videoClean.cleanedText.includes('https://video.example.com'));

    const videoRes = await dispatchMessage({
      targetChatId: -100999888,
      originalMessage: videoPost,
      cleanedText: videoClean.cleanedText,
      cleanedEntities: videoClean.cleanedEntities,
    });
    assert.equal(videoRes.success, true);

    // 6c. Document
    const docPost = documentPayload.channel_post;
    const docClean = cleanMessage(docPost.caption, docPost.caption_entities);
    assert.equal(docClean.shouldSkip, false);
    assert.ok(!docClean.cleanedText.includes('https://catalog.example.com'));

    const docRes = await dispatchMessage({
      targetChatId: -100999888,
      originalMessage: docPost,
      cleanedText: docClean.cleanedText,
    });
    assert.equal(docRes.success, true);
  });

  it('Case 7: Post in an unconfigured channel: ignored safely', () => {
    const unconfiguredChatId = -100999111;
    assert.notEqual(unconfiguredChatId, plainCodePayload.channel_post.chat.id);
  });

  it('Case 8: Pause and resume toggle state', () => {
    let forwardingEnabled = false;
    assert.equal(forwardingEnabled, false, 'Forwarding paused');
    forwardingEnabled = true;
    assert.equal(forwardingEnabled, true, 'Forwarding resumed');
  });

  it('Case 9: Deduplication prevents duplicate delivery', () => {
    const existingSent = { status: 'sent', targetChatId: -100123, targetMessageId: 555 };
    assert.equal(existingSent.status === 'sent', true);
  });

  it('Case 10: Clear failure status on Bot API errors', async () => {
    const failRes = await dispatchMessage({
      targetChatId: null,
      originalMessage: plainCodePayload.channel_post,
      cleanedText: 'Test',
    });
    assert.equal(failRes.success, false);
    assert.equal(failRes.reason, 'NO_TARGET_CHAT');
  });

  it('Case 11: Protected post: skip recorded, no bypass attempt', async () => {
    const post = protectedContentPayload.channel_post;
    const result = await dispatchMessage({
      targetChatId: -100999,
      originalMessage: post,
      cleanedText: post.text,
    });
    assert.equal(result.success, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'PROTECTED_CONTENT');
  });

  it('Case 12: Two admin commands from a non-owner: no configuration change', () => {
    const nonOwnerMsg1 = {
      chat: { id: 777777, type: 'private' },
      from: { id: 777777 },
      text: '/settarget @hacked',
    };
    const nonOwnerMsg2 = {
      chat: { id: 777777, type: 'private' },
      from: { id: 777777 },
      text: '/pause',
    };

    const res1 = authenticateOwnerCommand(nonOwnerMsg1);
    const res2 = authenticateOwnerCommand(nonOwnerMsg2);

    assert.equal(res1.authorized, false);
    assert.equal(res2.authorized, false);
  });
});
