// tgcloud/handlers/message.js
// Forward Mate — Owner Private Message Handler.
// Processes administrative commands strictly for allowlisted owners in private chats.

import { api } from 'sdk';
import { db } from 'sdk/db';
import { authenticateOwnerCommand } from '../lib/auth.js';
import { getSettings, updateSettings } from '../lib/settings_store.js';
import {
  upsertSourceChannel,
  removeSourceChannel,
  listSourceChannels,
} from '../lib/source_store.js';
import {
  listStripRules,
  addStripRule,
  deleteStripRule,
} from '../lib/rules_store.js';
import { getRecentFailedPosts } from '../lib/dedupe_store.js';
import { sourceChannels } from '../schema.js';
import { logger } from '../lib/logger.js';

/**
 * Normalizes user input channel identifiers:
 * Handles https://t.me/channel, t.me/channel, @channel, channel, or numeric ID -100xxxxxxxxxx.
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizeChannelInput(input) {
  if (!input || typeof input !== 'string') return '';
  let str = input.trim();
  // Strip URL prefixes like https://t.me/, http://t.me/, t.me/, etc.
  str = str.replace(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\//i, '');
  // Strip trailing slashes
  str = str.replace(/\/+$/, '');
  // Numeric IDs are preserved as-is
  if (/^-?\d+$/.test(str)) {
    return str;
  }
  // Public channel usernames get a leading @
  if (!str.startsWith('@')) {
    str = '@' + str;
  }
  return str;
}

export default async function (message, ctx) {
  if (!message || !message.text) {
    return;
  }

  // 1. Authenticate owner in private chat
  const auth = authenticateOwnerCommand(message);
  if (!auth.authorized) {
    if (auth.reason === 'NOT_PRIVATE_CHAT') {
      // Group/channel messages: silently ignore to prevent group spam
      return;
    }

    if (auth.reason === 'OWNER_NOT_CONFIGURED') {
      await api.sendMessage({
        chat_id: message.chat.id,
        text:
          `⚠️ *Forward Mate Setup Required*\n\n` +
          `No owner ID is configured yet.\n` +
          `Your Telegram User ID: \`${auth.userId}\`\n` +
          (auth.username ? `Your Username: @${auth.username}\n` : '') +
          `\nPlease add your details to \`tgcloud/lib/config.js\` to enable admin access.`,
        parse_mode: 'Markdown',
      });
      return;
    }

    // Explicit unauthorized user
    await api.sendMessage({
      chat_id: message.chat.id,
      text: '⛔ Access denied. You are not authorized to configure this bot.',
    });
    return;
  }

  const rawText = message.text.trim();
  const firstSpaceIndex = rawText.indexOf(' ');
  const command = (firstSpaceIndex === -1 ? rawText : rawText.slice(0, firstSpaceIndex)).toLowerCase();
  const restOfText = firstSpaceIndex === -1 ? '' : rawText.slice(firstSpaceIndex).trim();
  const args = restOfText ? restOfText.split(/\s+/) : [];

  try {
    switch (command) {
      case '/start': {
        await api.sendMessage({
          chat_id: message.chat.id,
          text:
            `🤖 *Forward Mate — Automatic Post Forwarder & Link Cleaner*\n\n` +
            `Hello! Forward Mate is ready.\n\n` +
            `*Quick Setup:*\n` +
            `1. Promote this bot as an **Administrator** in your destination channel.\n` +
            `2. Run \`/settarget @your_destination_channel\` or send its link.\n` +
            `3. Add this bot as an **Administrator** in your source channel.\n` +
            `4. Run \`/addsource @your_source_channel\` or send its link.\n\n` +
            `Any new post published in your source channel will automatically be forwarded to your destination channel, with all unwanted URLs, link anchors, and previous sender names stripped!`,
          parse_mode: 'Markdown',
        });
        break;
      }

      case '/help': {
        await api.sendMessage({
          chat_id: message.chat.id,
          text:
            `📋 *Forward Mate — Admin Commands*\n\n` +
            `*Setup & Channels:*\n` +
            `• /settarget <@channel or link> — Set destination channel\n` +
            `• /addsource <@channel or link> — Add source channel to monitor\n` +
            `• /removesource <@channel> — Remove source channel\n` +
            `• /listsources — List all monitored channels\n\n` +
            `*Status & Control:*\n` +
            `• /status — Check target, source count & forwarding state\n` +
            `• /pause — Pause forwarding across all sources\n` +
            `• /resume — Resume automated forwarding\n` +
            `• /setdryrun on|off — Toggle simulation vs live publishing\n\n` +
            `*Cleaning Rules:*\n` +
            `• /setlinks on|off — Toggle link cleaning\n` +
            `• /addsignature <text> — Add exact signature line to strip\n` +
            `• /listsignatures — List active signature rules\n` +
            `• /delsignature <id> — Delete signature rule\n\n` +
            `*Diagnostics:*\n` +
            `• /failed — View recent delivery errors\n` +
            `• /retryfailed — Retry failed posts\n\n` +
            `_Note: The bot must be an Administrator with posting rights in both channels._`,
          parse_mode: 'Markdown',
        });
        break;
      }

      case '/status': {
        const settings = await getSettings();
        let sourceCount = 0;
        try {
          sourceCount = await db.$count(sourceChannels);
        } catch {
          sourceCount = 0;
        }

        const targetDisplay = settings.targetChatId
          ? `\`${settings.targetChatId}\``
          : '⚠️ Not configured (use /settarget)';
        const forwardingDisplay = settings.forwardingEnabled
          ? '🟢 Active'
          : '⏸️ Paused (use /resume)';
        const dryRunDisplay = settings.dryRun
          ? '🟡 Enabled (simulating, no actual posting)'
          : '🟢 Disabled (publishing LIVE to destination)';
        const linksDisplay = settings.removeLinksGlobal ? 'Enabled' : 'Disabled';

        await api.sendMessage({
          chat_id: message.chat.id,
          text:
            `📊 *Forward Mate — Operating Status*\n\n` +
            `• *Destination Target:* ${targetDisplay}\n` +
            `• *Monitored Sources:* ${sourceCount}\n` +
            `• *Forwarding State:* ${forwardingDisplay}\n` +
            `• *Dry Run Mode:* ${dryRunDisplay}\n` +
            `• *Link Cleaning:* ${linksDisplay}\n`,
          parse_mode: 'Markdown',
        });
        break;
      }

      case '/settarget': {
        if (args.length === 0) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: 'Usage: `/settarget @channel_username` or `/settarget https://t.me/channel_username`',
            parse_mode: 'Markdown',
          });
          return;
        }

        const normalized = normalizeChannelInput(args[0]);
        try {
          const chat = await api.getChat({ chat_id: normalized });
          const me = await api.getMe();
          const member = await api.getChatMember({ chat_id: chat.id, user_id: me.id });

          const isAdmin = member.status === 'administrator' || member.status === 'creator';
          if (!isAdmin) {
            await api.sendMessage({
              chat_id: message.chat.id,
              text: `⚠️ Bot is not an administrator in destination channel "${chat.title}". Please promote the bot with "Post Messages" permission first.`,
            });
            return;
          }

          if (member.can_post_messages === false) {
            await api.sendMessage({
              chat_id: message.chat.id,
              text: `⚠️ Bot is an admin in "${chat.title}" but lacks the "Post Messages" permission. Please enable posting rights.`,
            });
            return;
          }

          await updateSettings({ targetChatId: chat.id });

          await api.sendMessage({
            chat_id: message.chat.id,
            text:
              `✅ *Destination Channel Configured*\n\n` +
              `• Title: *${chat.title}*\n` +
              `• Chat ID: \`${chat.id}\`\n` +
              (chat.username ? `• Username: @${chat.username}\n` : '') +
              `\nNew posts from your sources will now be published here automatically without links or previous sender badges!`,
            parse_mode: 'Markdown',
          });
        } catch (err) {
          logger.error('Failed to resolve target channel in /settarget', err);
          await api.sendMessage({
            chat_id: message.chat.id,
            text: `❌ Could not resolve destination channel \`${normalized}\`. Ensure the link/username is correct and the bot has been added as an admin with posting rights.`,
            parse_mode: 'Markdown',
          });
        }
        break;
      }

      case '/addsource': {
        if (args.length === 0) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: 'Usage: `/addsource @source_channel` or `/addsource https://t.me/source_channel`',
            parse_mode: 'Markdown',
          });
          return;
        }

        const normalized = normalizeChannelInput(args[0]);
        try {
          const chat = await api.getChat({ chat_id: normalized });
          const me = await api.getMe();
          let hasAccess = false;
          let memberStatus = 'unknown';
          try {
            const member = await api.getChatMember({ chat_id: chat.id, user_id: me.id });
            memberStatus = member.status;
            hasAccess =
              member.status === 'administrator' ||
              member.status === 'creator' ||
              member.status === 'member';
          } catch (memberErr) {
            logger.warn('Could not check chat member status', { error: memberErr.message });
          }

          if (!hasAccess) {
            await api.sendMessage({
              chat_id: message.chat.id,
              text:
                `⚠️ *Bot is not an Admin in "${chat.title}"*\n\n` +
                `Current status: \`${memberStatus}\`\n\n` +
                `👉 Telegram Bot API rules require the bot to be added as an **Administrator** in channel \`${normalized}\` so Telegram sends channel post updates to the bot.`,
              parse_mode: 'Markdown',
            });
            return;
          }

          await upsertSourceChannel({
            chatId: chat.id,
            username: chat.username,
            title: chat.title,
            enabled: true,
            removeLinks: true,
            stripSignatures: true,
          });

          await api.sendMessage({
            chat_id: message.chat.id,
            text:
              `✅ *Source Channel Added*\n\n` +
              `• Title: *${chat.title}*\n` +
              `• Chat ID: \`${chat.id}\`\n` +
              (chat.username ? `• Username: @${chat.username}\n` : '') +
              `• Status: 🟢 Monitored & Enabled\n\n` +
              `Any new message posted in this channel will be cleaned and published to your destination channel automatically.`,
            parse_mode: 'Markdown',
          });
        } catch (err) {
          logger.error('Failed to resolve source channel in /addsource', err);
          const errDesc = err?.description || err?.message || 'Chat not found';
          await api.sendMessage({
            chat_id: message.chat.id,
            text:
              `❌ *Could not resolve source channel \`${normalized}\`*\n\n` +
              `*Reason:* ${errDesc}\n\n` +
              `*Solution:* Ensure:\n` +
              `1. The username \`${normalized}\` is correct and public (or use numeric ID for private channels).\n` +
              `2. The bot is added as an **Administrator** in \`${normalized}\`. (Telegram only lets bots access channel info if they are an admin).`,
            parse_mode: 'Markdown',
          });
        }
        break;
      }

      case '/removesource': {
        if (args.length === 0) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: 'Usage: `/removesource @channel` or `/removesource https://t.me/channel`',
            parse_mode: 'Markdown',
          });
          return;
        }

        const normalized = normalizeChannelInput(args[0]);
        let chatIdToRemove = null;

        if (/^-?\d+$/.test(normalized)) {
          chatIdToRemove = Number(normalized);
        } else {
          try {
            const chat = await api.getChat({ chat_id: normalized });
            chatIdToRemove = chat.id;
          } catch {
            const cleanName = normalized.replace(/^@/, '').toLowerCase();
            const all = await listSourceChannels();
            const match = all.find((s) => s.username && s.username.toLowerCase() === cleanName);
            if (match) {
              chatIdToRemove = match.chatId;
            }
          }
        }

        if (!chatIdToRemove) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: `❌ Could not find source channel matching \`${normalized}\`. Use /listsources to check configured channels.`,
            parse_mode: 'Markdown',
          });
          return;
        }

        const removed = await removeSourceChannel(chatIdToRemove);
        if (removed) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: `✅ Source channel \`${chatIdToRemove}\` removed from monitoring.`,
            parse_mode: 'Markdown',
          });
        } else {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: `⚠️ Source channel \`${chatIdToRemove}\` was not found in the monitoring list.`,
            parse_mode: 'Markdown',
          });
        }
        break;
      }

      case '/listsources': {
        const sources = await listSourceChannels();
        if (sources.length === 0) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: 'ℹ️ No source channels configured yet. Use `/addsource @channel` to add one.',
            parse_mode: 'Markdown',
          });
          return;
        }

        const lines = sources.map((s, idx) => {
          const status = s.enabled ? '🟢 Enabled' : '⏸️ Disabled';
          const name = s.title || (s.username ? `@${s.username}` : 'Untitled');
          return `${idx + 1}. *${name}* (\`${s.chatId}\`)\n   Status: ${status} | Link Cleaning: ${s.removeLinks ? 'Yes' : 'No'}`;
        });

        await api.sendMessage({
          chat_id: message.chat.id,
          text: `📡 *Monitored Source Channels (${sources.length}):*\n\n${lines.join('\n\n')}`,
          parse_mode: 'Markdown',
        });
        break;
      }

      case '/pause': {
        await updateSettings({ forwardingEnabled: false });
        await api.sendMessage({
          chat_id: message.chat.id,
          text: '⏸️ *Forwarding Paused*\n\nNew channel posts will be ignored until you /resume.',
          parse_mode: 'Markdown',
        });
        break;
      }

      case '/resume': {
        await updateSettings({ forwardingEnabled: true });
        await api.sendMessage({
          chat_id: message.chat.id,
          text: '▶️ *Forwarding Resumed*\n\nNew channel posts will now be processed automatically.',
          parse_mode: 'Markdown',
        });
        break;
      }

      case '/setdryrun': {
        const mode = args[0]?.toLowerCase();
        if (mode !== 'on' && mode !== 'off') {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: 'Usage: `/setdryrun on` or `/setdryrun off`',
            parse_mode: 'Markdown',
          });
          return;
        }

        const isDryRun = mode === 'on';
        await updateSettings({ dryRun: isDryRun });
        await api.sendMessage({
          chat_id: message.chat.id,
          text: isDryRun
            ? '🟡 *Dry Run Enabled*\n\nPosts will be cleaned and simulated in logs, but NOT published to destination.'
            : '🟢 *Dry Run Disabled*\n\nPosts will now be published LIVE to your destination channel!',
          parse_mode: 'Markdown',
        });
        break;
      }

      case '/setlinks': {
        const mode = args[0]?.toLowerCase();
        if (mode !== 'on' && mode !== 'off') {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: 'Usage: `/setlinks on` or `/setlinks off`',
            parse_mode: 'Markdown',
          });
          return;
        }

        const isEnabled = mode === 'on';
        await updateSettings({ removeLinksGlobal: isEnabled });
        await api.sendMessage({
          chat_id: message.chat.id,
          text: `🔗 URL cleaning is now *${isEnabled ? 'Enabled' : 'Disabled'}* globally.`,
          parse_mode: 'Markdown',
        });
        break;
      }

      case '/addsignature': {
        if (!restOfText) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: 'Usage: `/addsignature <exact signature line to strip>`',
            parse_mode: 'Markdown',
          });
          return;
        }

        const rule = await addStripRule(restOfText);
        await api.sendMessage({
          chat_id: message.chat.id,
          text:
            `✅ *Signature Rule Added*\n\n` +
            `• ID: \`${rule.id}\`\n` +
            `• Literal Pattern: \`${rule.pattern}\`\n\n` +
            `This signature line will now be stripped from forwarded posts.`,
          parse_mode: 'Markdown',
        });
        break;
      }

      case '/listsignatures': {
        const rules = await listStripRules();
        if (rules.length === 0) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: 'ℹ️ No signature rules configured yet. Use `/addsignature <text>` to add one.',
            parse_mode: 'Markdown',
          });
          return;
        }

        const lines = rules.map(
          (r) => `• ID \`${r.id}\`: \`${r.pattern}\``
        );

        await api.sendMessage({
          chat_id: message.chat.id,
          text: `✂️ *Configured Signature Rules (${rules.length}):*\n\n${lines.join('\n')}`,
          parse_mode: 'Markdown',
        });
        break;
      }

      case '/delsignature': {
        const ruleId = args[0];
        if (!ruleId || !/^\d+$/.test(ruleId)) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: 'Usage: `/delsignature <numeric_rule_id>`',
            parse_mode: 'Markdown',
          });
          return;
        }

        const deleted = await deleteStripRule(ruleId);
        if (deleted) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: `✅ Signature rule \`${ruleId}\` has been deleted.`,
            parse_mode: 'Markdown',
          });
        } else {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: `⚠️ Signature rule \`${ruleId}\` was not found. Use /listsignatures to view rules.`,
            parse_mode: 'Markdown',
          });
        }
        break;
      }

      case '/failed': {
        const failed = await getRecentFailedPosts(10);
        if (failed.length === 0) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: '🎉 No recent delivery failures recorded!',
          });
          return;
        }

        const lines = failed.slice(-10).map((f) => {
          return `• Source \`${f.sourceChatId}\` Msg \`${f.sourceMessageId}\` | Error: \`${f.lastError || 'UNKNOWN'}\` (Attempts: ${f.attemptCount || 1})`;
        });

        await api.sendMessage({
          chat_id: message.chat.id,
          text: `⚠️ *Recent Delivery Failures (${failed.length}):*\n\n${lines.join('\n')}`,
          parse_mode: 'Markdown',
        });
        break;
      }

      case '/retryfailed': {
        const failed = await getRecentFailedPosts(5);
        if (failed.length === 0) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: 'ℹ️ No failed posts available to retry.',
          });
          return;
        }

        await api.sendMessage({
          chat_id: message.chat.id,
          text: `🔄 Found ${failed.length} failed posts. Retrying will occur on next update sync.`,
        });
        break;
      }

      default: {
        if (command.startsWith('/')) {
          await api.sendMessage({
            chat_id: message.chat.id,
            text: `Command \`${command}\` is not recognized. Use /help to see all available commands.`,
            parse_mode: 'Markdown',
          });
        }
        break;
      }
    }
  } catch (err) {
    logger.error('Error handling owner message command', err);
    await api.sendMessage({
      chat_id: message.chat.id,
      text: `❌ An internal error occurred while processing command \`${command}\`. Please try again.`,
      parse_mode: 'Markdown',
    });
  }
}
