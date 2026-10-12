// tests/cleaner.test.js
// Unit tests for Forward Mate cleaner.js and entities.js.
// Uses Node.js native test runner (node:test).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMessage } from '../tgcloud/lib/cleaner.js';
import { remapEntities } from '../tgcloud/lib/entities.js';

describe('Message & Caption Cleaner (tgcloud/lib/cleaner.js)', () => {
  describe('Plain URLs and Web Links Removal', () => {
    it('should remove plain https:// and http:// links', () => {
      const text = 'Check out this awesome deal https://example.com/item and http://promo.net today!';
      const result = cleanMessage(text);

      assert.equal(result.shouldSkip, false);
      assert.ok(!result.cleanedText.includes('https://'));
      assert.ok(!result.cleanedText.includes('http://'));
      assert.ok(result.cleanedText.includes('Check out this awesome deal'));
      assert.ok(result.cleanedText.includes('today!'));
      assert.equal(result.removedLinkCount, 2);
    });

    it('should remove www. links', () => {
      const text = 'Visit www.amazon.in for top offers on electronics.';
      const result = cleanMessage(text);

      assert.equal(result.shouldSkip, false);
      assert.ok(!result.cleanedText.includes('www.amazon.in'));
      assert.ok(result.cleanedText.includes('for top offers on electronics.'));
    });

    it('should remove t.me and telegram.me links', () => {
      const text = 'Join our updates group t.me/samplegroup or telegram.me/anotherchannel for free.';
      const result = cleanMessage(text);

      assert.equal(result.shouldSkip, false);
      assert.ok(!result.cleanedText.includes('t.me/samplegroup'));
      assert.ok(!result.cleanedText.includes('telegram.me/anotherchannel'));
    });

    it('should handle trailing punctuation after URLs cleanly', () => {
      const text = 'Great deal at https://shop.com/sale! Do not miss it.';
      const result = cleanMessage(text);

      assert.equal(result.shouldSkip, false);
      assert.ok(!result.cleanedText.includes('https://shop.com/sale'));
      assert.ok(result.cleanedText.includes('Great deal at'));
      assert.ok(result.cleanedText.includes('Do not miss it.'));
    });
  });

  describe('Coupon / Promo Code Preservation', () => {
    it('should preserve code string next to a URL', () => {
      const text = 'Use code: SAVE20 at https://brand.com/checkout for 20% off';
      const result = cleanMessage(text);

      assert.equal(result.shouldSkip, false);
      assert.ok(result.cleanedText.includes('SAVE20'));
      assert.ok(!result.cleanedText.includes('https://brand.com'));
    });

    it('should preserve promo codes, amounts, and discounts without disruption', () => {
      const text =
        '🔥 FLASH SALE: Nike Air Max\n' +
        'Price: ₹4,999 (was ₹9,999)\n' +
        'Coupon: FLAT50\n' +
        'Link: https://dealurl.com/nike\n' +
        'Limited stock available!';

      const result = cleanMessage(text);

      assert.equal(result.shouldSkip, false);
      assert.ok(result.cleanedText.includes('FLAT50'));
      assert.ok(result.cleanedText.includes('₹4,999'));
      assert.ok(result.cleanedText.includes('Price:'));
      assert.ok(!result.cleanedText.includes('https://dealurl.com'));
      assert.ok(result.cleanedText.includes('Limited stock available!'));
    });
  });

  describe('Telegram Message Entities & Hidden Text Links', () => {
    it('should remove hidden text_link anchor text completely to avoid misleading phrases', () => {
      // In Telegram, text_link has an anchor text that is clickable
      const text = 'Get your tickets [click here] now!';
      const entities = [
        {
          type: 'text_link',
          offset: 17,
          length: 12, // '[click here]'
          url: 'https://tickets.com',
        },
      ];

      const result = cleanMessage(text, entities);

      assert.equal(result.shouldSkip, false);
      assert.ok(!result.cleanedText.includes('click here'));
      assert.ok(!result.cleanedText.includes('https://tickets.com'));
      assert.ok(result.cleanedText.includes('Get your tickets'));
    });

    it('should remap formatting entities correctly when preceded by non-BMP emoji and stripped link', () => {
      // "🔥 Big deal https://deal.com Code: SAVE10"
      // "🔥" is 2 UTF-16 code units
      const emoji = '🔥';
      assert.equal(emoji.length, 2);

      const text = `${emoji} Big deal https://deal.com Code: SAVE10`;
      // 'Code: SAVE10' is bold entity
      const boldOffset = text.indexOf('Code: SAVE10');
      const boldLength = 'Code: SAVE10'.length;

      const entities = [
        {
          type: 'url',
          offset: text.indexOf('https://deal.com'),
          length: 'https://deal.com'.length,
        },
        {
          type: 'bold',
          offset: boldOffset,
          length: boldLength,
        },
      ];

      const result = cleanMessage(text, entities);

      assert.equal(result.shouldSkip, false);
      assert.ok(!result.cleanedText.includes('https://deal.com'));
      assert.ok(result.cleanedText.includes('Code: SAVE10'));

      // Check remapped bold entity
      const boldEntity = result.cleanedEntities.find((e) => e.type === 'bold');
      assert.ok(boldEntity, 'Bold entity should be preserved');
      const textUnderBold = result.cleanedText.slice(
        boldEntity.offset,
        boldEntity.offset + boldEntity.length
      );
      assert.equal(textUnderBold, 'Code: SAVE10');
    });
  });

  describe('Literal Signature Rules Removal', () => {
    it('should remove exact configured signature lines', () => {
      const text =
        'Exclusive Deal of the Day!\n' +
        'Grab your headphone for $49.\n' +
        'Join our Telegram channel: @GreatDeals\n' +
        'Forwarded by ForwardBot';

      const signatures = ['Join our Telegram channel: @GreatDeals', 'Forwarded by ForwardBot'];

      const result = cleanMessage(text, [], signatures);

      assert.equal(result.shouldSkip, false);
      assert.ok(result.cleanedText.includes('Exclusive Deal of the Day!'));
      assert.ok(result.cleanedText.includes('Grab your headphone for $49.'));
      assert.ok(!result.cleanedText.includes('@GreatDeals'));
      assert.ok(!result.cleanedText.includes('Forwarded by ForwardBot'));
    });

    it('should not remove unrelated lines merely because they share a word', () => {
      const text = 'Great deal on GreatDeals shoes! Buy today.';
      const signatures = ['Join our Telegram channel: @GreatDeals'];

      const result = cleanMessage(text, [], signatures);

      assert.equal(result.shouldSkip, false);
      assert.equal(result.cleanedText, 'Great deal on GreatDeals shoes! Buy today.');
    });
  });

  describe('Whitespace and Empty Post Handling', () => {
    it('should collapse multiple consecutive blank lines', () => {
      const text = 'Line 1\n\n\n\n\nLine 2';
      const result = cleanMessage(text);

      assert.equal(result.shouldSkip, false);
      assert.equal(result.cleanedText, 'Line 1\n\nLine 2');
    });

    it('should skip post if message contains only a URL', () => {
      const text = 'https://onlyurl.com/something';
      const result = cleanMessage(text);

      assert.equal(result.shouldSkip, true);
      assert.equal(result.skipReason, 'EMPTY_AFTER_CLEANING');
      assert.equal(result.cleanedText, '');
    });

    it('should skip post if message contains only links and signatures', () => {
      const text = 'https://link.com\nJoin: @channel';
      const signatures = ['Join: @channel'];
      const result = cleanMessage(text, [], signatures);

      assert.equal(result.shouldSkip, true);
      assert.equal(result.skipReason, 'EMPTY_AFTER_CLEANING');
      assert.equal(result.cleanedText, '');
    });

    it('should skip empty or null input gracefully', () => {
      assert.equal(cleanMessage('').shouldSkip, true);
      assert.equal(cleanMessage(null).shouldSkip, true);
      assert.equal(cleanMessage(undefined).shouldSkip, true);
    });
  });
});
