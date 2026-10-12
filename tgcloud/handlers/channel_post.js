// tgcloud/handlers/channel_post.js
// Forward Mate — Channel Post Update Handler.
// Processes incoming channel posts from monitored source channels and republishes
// cleaned content to the configured destination channel with deduplication and state tracking.

import { getSourceChannel } from '../lib/source_store.js';
import { getSettings } from '../lib/settings_store.js';
import { listStripRules } from '../lib/rules_store.js';
import { cleanMessage } from '../lib/cleaner.js';
import { dispatchMessage } from '../lib/message_dispatch.js';
import {
  claimPost,
  markPostSent,
  markPostSkipped,
  markPostFailed,
} from '../lib/dedupe_store.js';
import { logger } from '../lib/logger.js';

export default async function (channelPost, ctx) {
  if (!channelPost || !channelPost.chat) {
    return;
  }

  const sourceChatId = channelPost.chat.id;
  const sourceMessageId = channelPost.message_id;

  // 1. Verify source channel allowlist
  const source = await getSourceChannel(sourceChatId);
  if (!source || !source.enabled) {
    // Unconfigured or disabled channel — ignore update silently
    return;
  }

  // 2. Check global bot settings
  const settings = await getSettings();
  if (!settings.targetChatId) {
    logger.warn('Incoming channel post received but destination channel is not configured', {
      sourceChatId,
      sourceMessageId,
    });
    return;
  }

  if (!settings.forwardingEnabled) {
    logger.info('Forwarding is currently paused; post ignored', {
      sourceChatId,
      sourceMessageId,
    });
    return;
  }

  // 3. Idempotency & Deduplication Guard
  const claim = await claimPost(sourceChatId, sourceMessageId);
  if (!claim.canProcess) {
    logger.info('Ignoring duplicate or already processed update', {
      sourceChatId,
      sourceMessageId,
      reason: claim.reason,
    });
    return { duplicate: true, reason: claim.reason };
  }

  // 4. Extract text or caption and entities
  const rawText = channelPost.text || channelPost.caption || '';
  const rawEntities = channelPost.entities || channelPost.caption_entities || [];

  // 5. Load configured signature rules
  const rules = await listStripRules();

  // 6. Clean text/caption
  const shouldRemoveLinks = source.removeLinks && settings.removeLinksGlobal;
  const shouldStripSignatures = source.stripSignatures;

  const cleanResult = cleanMessage(rawText, rawEntities, rules, {
    removeLinks: shouldRemoveLinks,
    stripSignatures: shouldStripSignatures,
    preserveEntities: true,
  });

  // 7. Check if meaningful text remains
  const isMedia = Boolean(
    channelPost.photo ||
      channelPost.video ||
      channelPost.document ||
      channelPost.animation ||
      channelPost.audio ||
      channelPost.voice ||
      channelPost.sticker
  );

  if (!isMedia && cleanResult.shouldSkip) {
    logger.info('Text message contains only removable links/signatures; skipping', {
      sourceChatId,
      sourceMessageId,
      skipReason: cleanResult.skipReason,
    });
    await markPostSkipped(sourceChatId, sourceMessageId, cleanResult.skipReason);
    return { skipped: true, reason: cleanResult.skipReason };
  }

  // 8. Dry run simulation mode
  if (settings.dryRun) {
    logger.info('[DRY RUN] Channel post processed (simulated, not published)', {
      sourceChatId,
      sourceMessageId,
      targetChatId: settings.targetChatId,
      removedLinks: cleanResult.removedLinkCount,
      cleanedLength: cleanResult.cleanedText.length,
    });
    await markPostSkipped(sourceChatId, sourceMessageId, 'DRY_RUN_SIMULATED');
    return {
      dryRun: true,
      sourceChatId,
      sourceMessageId,
      cleanedText: cleanResult.cleanedText,
    };
  }

  // 9. Dispatch cleaned message/media to destination channel
  const dispatchResult = await dispatchMessage({
    targetChatId: settings.targetChatId,
    originalMessage: channelPost,
    cleanedText: cleanResult.cleanedText,
    cleanedEntities: cleanResult.cleanedEntities,
  });

  if (dispatchResult.success) {
    await markPostSent(sourceChatId, sourceMessageId, {
      targetChatId: settings.targetChatId,
      targetMessageId: dispatchResult.targetMessageId,
    });
    logger.info('Successfully forwarded cleaned post', {
      sourceChatId,
      sourceMessageId,
      targetChatId: settings.targetChatId,
      targetMessageId: dispatchResult.targetMessageId,
    });
  } else if (dispatchResult.skipped) {
    await markPostSkipped(sourceChatId, sourceMessageId, dispatchResult.reason);
  } else {
    await markPostFailed(
      sourceChatId,
      sourceMessageId,
      dispatchResult.error || dispatchResult.reason
    );
    logger.error('Failed to forward post to destination channel', {
      sourceChatId,
      sourceMessageId,
      reason: dispatchResult.reason,
    });
  }

  return dispatchResult;
}
