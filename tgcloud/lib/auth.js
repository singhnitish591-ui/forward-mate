// tgcloud/lib/auth.js
// Forward Mate — Authentication & Authorization Guards.
// Restricts all administrative commands strictly to allowlisted owners in private chats.

import { OWNER_USER_IDS, OWNER_USERNAMES } from './config.js';

/**
 * Checks whether the incoming message is from a Telegram private chat (1-on-1 with bot).
 * Commands in groups, supergroups, or channels are rejected.
 *
 * @param {object} message Telegram Message object
 * @returns {boolean}
 */
export function isPrivateChat(message) {
  return Boolean(message && message.chat && message.chat.type === 'private');
}

/**
 * Checks whether a given Telegram user is on the explicit owner allowlist
 * by numeric User ID or configured username.
 *
 * @param {object|number|string} from User object or numeric ID / username
 * @returns {boolean}
 */
export function isOwner(from) {
  if (!from) return false;

  let userId = null;
  let username = null;

  if (typeof from === 'object') {
    userId = from.id;
    username = from.username ? from.username.toLowerCase().replace(/^@/, '') : null;
  } else if (typeof from === 'string') {
    if (/^-?\d+$/.test(from)) {
      userId = Number(from);
    } else {
      username = from.toLowerCase().replace(/^@/, '');
    }
  } else if (typeof from === 'number') {
    userId = from;
  }

  // 1. Check numeric user ID allowlist
  if (userId) {
    const numericId = Number(userId);
    if (Number.isSafeInteger(numericId) && Array.isArray(OWNER_USER_IDS)) {
      if (OWNER_USER_IDS.some((id) => Number(id) === numericId)) {
        return true;
      }
    }
  }

  // 2. Check username allowlist (case-insensitive)
  if (username && Array.isArray(OWNER_USERNAMES)) {
    if (OWNER_USERNAMES.some((u) => u.toLowerCase().replace(/^@/, '') === username)) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates whether an incoming message is an authorized owner command.
 *
 * Rejection rules:
 * 1. Must be a private chat. Group commands are rejected.
 * 2. User must be in OWNER_USER_IDS or OWNER_USERNAMES.
 *
 * @param {object} message Telegram Message object
 * @returns {{ authorized: boolean, reason?: string, userId?: number, username?: string }}
 */
export function authenticateOwnerCommand(message) {
  if (!message) {
    return { authorized: false, reason: 'NO_MESSAGE' };
  }

  // 1. Group / Channel message rejection
  if (!isPrivateChat(message)) {
    return { authorized: false, reason: 'NOT_PRIVATE_CHAT' };
  }

  const from = message.from;
  const userId = from?.id;
  const username = from?.username;

  if (!userId) {
    return { authorized: false, reason: 'NO_USER_ID' };
  }

  const hasConfiguredAllowlist =
    (Array.isArray(OWNER_USER_IDS) && OWNER_USER_IDS.length > 0) ||
    (Array.isArray(OWNER_USERNAMES) && OWNER_USERNAMES.length > 0);

  // 2. Unconfigured owner allowlist check
  if (!hasConfiguredAllowlist) {
    return { authorized: false, reason: 'OWNER_NOT_CONFIGURED', userId, username };
  }

  // 3. Allowlist validation
  if (!isOwner(from)) {
    return { authorized: false, reason: 'UNAUTHORIZED_USER', userId, username };
  }

  return { authorized: true, userId, username };
}
