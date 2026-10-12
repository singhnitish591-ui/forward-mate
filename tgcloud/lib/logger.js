// tgcloud/lib/logger.js
// Forward Mate — Safe Structured Logger.
// Uses platform console methods. Never logs credentials or raw secret tokens.

/**
 * Sanitizes input strings/objects to avoid leaking token patterns.
 *
 * @param {any} item
 * @returns {any}
 */
function sanitize(item) {
  if (typeof item === 'string') {
    // Redact Bot API token pattern: \d{8,10}:[A-Za-z0-9_-]{35}
    return item.replace(/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, '[REDACTED_BOT_TOKEN]');
  }
  if (item && typeof item === 'object') {
    try {
      const copy = Array.isArray(item) ? [...item] : { ...item };
      for (const key of Object.keys(copy)) {
        if (/token|secret|password|auth/i.test(key)) {
          copy[key] = '[REDACTED]';
        } else {
          copy[key] = sanitize(copy[key]);
        }
      }
      return copy;
    } catch {
      return '[Unserializable]';
    }
  }
  return item;
}

export const logger = {
  info(message, context = {}) {
    console.info(`[INFO] ${message}`, sanitize(context));
  },
  warn(message, context = {}) {
    console.warn(`[WARN] ${message}`, sanitize(context));
  },
  error(message, errorOrContext = {}) {
    if (errorOrContext instanceof Error) {
      console.error(`[ERROR] ${message}: ${errorOrContext.message}`, {
        code: errorOrContext.code,
        name: errorOrContext.name,
      });
    } else {
      console.error(`[ERROR] ${message}`, sanitize(errorOrContext));
    }
  },
};
