// tgcloud/lib/config.js
// Forward Mate — Application Configuration & Owner Allowlist.

export const OWNER_USER_IDS = [
  // Numeric Telegram User IDs allowlist (e.g. 123456789)
];

export const OWNER_USERNAMES = [
  'Rkumar045', // Configured owner username
  'Rjyadav007', // Configured owner username
];

export const DEFAULT_CONFIG = {
  // Safe defaults
  forwardingEnabled: false, // Default false until target and sources are verified
  dryRun: true,             // Safe simulation mode by default until verified
  removeLinksGlobal: true,  // Clean links globally
};
