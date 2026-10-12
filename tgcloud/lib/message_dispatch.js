// tgcloud/lib/message_dispatch.js
// Forward Mate — Message Dispatcher.
// Sends rewritten plain text or media to the destination Telegram channel.
//
// Limitations explicitly documented:
// 1. Media albums (media_group_id): Telegram Serverless isolates are stateless and event-driven
//    with no continuous background queue or cron. Album items are published individually.
// 2. Protected content: Posts with has_protected_content = true or copy restrictions
//    are skipped and logged; the bot never attempts to bypass Telegram protections.
// 3. Unsupported types: Polls, dice, paid media, and location pins are logged and skipped.

import { api, BotApiError } from 'sdk';
import { logger } from './logger.js';

/**
 * Dispatches cleaned content to the destination channel.
 *
 * @param {object} params
 * @param {number} params.targetChatId Numeric destination channel ID
 * @param {object} params.originalMessage Incoming Telegram message from source channel
 * @param {string} params.cleanedText Cleaned text or caption
 * @param {Array<object>} params.cleanedEntities Cleaned and remapped formatting entities
 * @returns {Promise<{
 *   success: boolean,
 *   targetMessageId?: number,
 *   skipped?: boolean,
 *   reason?: string,
 *   error?: any
 * }>}
 */
export async function dispatchMessage({
  targetChatId,
  originalMessage,
  cleanedText,
  cleanedEntities = [],
}) {
  if (!targetChatId) {
    return { success: false, reason: 'NO_TARGET_CHAT' };
  }

  // 1. Protected content check
  if (originalMessage.has_protected_content) {
    logger.warn('Skipping message due to Telegram protected content restrictions', {
      sourceChatId: originalMessage.chat.id,
      messageId: originalMessage.message_id,
    });
    return {
      success: false,
      skipped: true,
      reason: 'PROTECTED_CONTENT',
    };
  }

  const entitiesParam = cleanedEntities.length > 0 ? cleanedEntities : undefined;

  try {
    // 2. Pure Text Message
    if (originalMessage.text) {
      const res = await api.sendMessage({
        chat_id: targetChatId,
        text: cleanedText,
        entities: entitiesParam,
      });
      return { success: true, targetMessageId: res.message_id };
    }

    // 3. Photo Message
    if (originalMessage.photo && originalMessage.photo.length > 0) {
      // Telegram sends multiple resolutions; select the highest resolution (last element)
      const highestResPhoto = originalMessage.photo[originalMessage.photo.length - 1];
      const res = await api.sendPhoto({
        chat_id: targetChatId,
        photo: highestResPhoto.file_id,
        caption: cleanedText || undefined,
        caption_entities: entitiesParam,
      });
      return { success: true, targetMessageId: res.message_id };
    }

    // 4. Video Message
    if (originalMessage.video) {
      const res = await api.sendVideo({
        chat_id: targetChatId,
        video: originalMessage.video.file_id,
        caption: cleanedText || undefined,
        caption_entities: entitiesParam,
      });
      return { success: true, targetMessageId: res.message_id };
    }

    // 5. Document / File Message
    if (originalMessage.document) {
      const res = await api.sendDocument({
        chat_id: targetChatId,
        document: originalMessage.document.file_id,
        caption: cleanedText || undefined,
        caption_entities: entitiesParam,
      });
      return { success: true, targetMessageId: res.message_id };
    }

    // 6. Animation (GIF)
    if (originalMessage.animation) {
      const res = await api.sendAnimation({
        chat_id: targetChatId,
        animation: originalMessage.animation.file_id,
        caption: cleanedText || undefined,
        caption_entities: entitiesParam,
      });
      return { success: true, targetMessageId: res.message_id };
    }

    // 7. Audio Message
    if (originalMessage.audio) {
      const res = await api.sendAudio({
        chat_id: targetChatId,
        audio: originalMessage.audio.file_id,
        caption: cleanedText || undefined,
        caption_entities: entitiesParam,
      });
      return { success: true, targetMessageId: res.message_id };
    }

    // 8. Voice Message
    if (originalMessage.voice) {
      const res = await api.sendVoice({
        chat_id: targetChatId,
        voice: originalMessage.voice.file_id,
        caption: cleanedText || undefined,
        caption_entities: entitiesParam,
      });
      return { success: true, targetMessageId: res.message_id };
    }

    // 9. Sticker (No caption allowed; copy without forwarded-from attribution)
    if (originalMessage.sticker) {
      const res = await api.copyMessage({
        chat_id: targetChatId,
        from_chat_id: originalMessage.chat.id,
        message_id: originalMessage.message_id,
      });
      return { success: true, targetMessageId: res.message_id };
    }

    // 10. Unsupported Telegram Content Types
    logger.warn('Skipping unsupported Telegram message type', {
      sourceChatId: originalMessage.chat.id,
      messageId: originalMessage.message_id,
    });
    return {
      success: false,
      skipped: true,
      reason: 'UNSUPPORTED_MEDIA_TYPE',
    };
  } catch (err) {
    if (err instanceof BotApiError) {
      logger.error('Telegram BotApiError during message dispatch', {
        code: err.code,
        description: err.description,
        parameters: err.parameters,
      });
    } else {
      logger.error('Unexpected error during message dispatch', err);
    }
    return {
      success: false,
      error: err,
      reason: err.description || err.message || 'DISPATCH_ERROR',
    };
  }
}
