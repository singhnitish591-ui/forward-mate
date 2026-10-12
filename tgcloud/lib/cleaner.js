// tgcloud/lib/cleaner.js
// Forward Mate — Pure URL and Signature Cleaner.
//
// Rules:
// 1. Pure, dependency-free JavaScript. No npm packages.
// 2. Removes visible URLs (http, https, www, t.me) and text_link anchor spans.
// 3. Removes configured literal signature lines.
// 4. Preserves coupon codes, discount amounts, product names, emojis, and normal line breaks.
// 5. Adjusts Telegram formatting entities safely using UTF-16 code units.
// 6. Skips posts if no meaningful content remains.

import { remapEntities, validateEntitiesInBounds } from './entities.js';

/**
 * Escapes regex special characters in a literal string.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds all deletion spans for visible URLs and Telegram entities in text.
 *
 * @param {string} text Original text
 * @param {Array<object>} [entities=[]] Telegram entities
 * @param {Array<string>} [signatureRules=[]] Literal signature patterns to strip
 * @param {object} [options={}]
 * @returns {{ spans: Array<{start: number, end: number}>, linkCount: number }}
 */
export function findDeletionSpans(text, entities = [], signatureRules = [], options = {}) {
  const removeLinks = options.removeLinks !== false;
  const stripSignatures = options.stripSignatures !== false;
  const spans = [];
  let linkCount = 0;

  // 1. Extract spans from Telegram entities of type 'url' and 'text_link'
  if (removeLinks && Array.isArray(entities)) {
    for (const ent of entities) {
      if (ent.type === 'url' || ent.type === 'text_link') {
        if (
          typeof ent.offset === 'number' &&
          typeof ent.length === 'number' &&
          ent.offset >= 0 &&
          ent.offset + ent.length <= text.length
        ) {
          spans.push({
            start: ent.offset,
            end: ent.offset + ent.length,
            type: ent.type,
          });
          linkCount++;
        }
      }
    }
  }

  // 2. Regex-based visible URL detection (HTTP/HTTPS, www., t.me, telegram.me)
  if (removeLinks) {
    const urlRegex = /(?:https?:\/\/|www\.|(?:\b(?:t|telegram)\.me\/))[^\s<>]+/gi;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      let start = match.index;
      let urlStr = match[0];

      // Trim trailing punctuation attached to URLs (like ., ,, !, ?, ), ])
      const trailingPunctMatch = urlStr.match(/[.,!?;:()[\]]+$/);
      let end = start + urlStr.length;
      if (trailingPunctMatch) {
        end -= trailingPunctMatch[0].length;
      }

      if (end > start) {
        spans.push({ start, end, type: 'regex_url' });
        linkCount++;
      }
    }
  }

  // 3. Literal signature rules stripping
  if (stripSignatures && Array.isArray(signatureRules)) {
    for (const rule of signatureRules) {
      const pattern = typeof rule === 'string' ? rule.trim() : rule?.pattern?.trim();
      if (!pattern) continue;

      const escaped = escapeRegex(pattern);
      // Match the pattern, optionally consuming leading/trailing newline if it forms a line
      const sigRegex = new RegExp(`(?:\\r?\\n)?[ \\t]*${escaped}[ \\t]*(?:\\r?\\n)?`, 'gi');
      let match;
      while ((match = sigRegex.exec(text)) !== null) {
        spans.push({
          start: match.index,
          end: match.index + match[0].length,
          type: 'signature',
        });
      }
    }
  }

  // 4. Merge overlapping and adjacent spans
  if (spans.length === 0) {
    return { spans: [], linkCount: 0 };
  }

  spans.sort((a, b) => a.start - b.start || b.end - a.end);

  const merged = [];
  let current = { ...spans[0] };

  for (let i = 1; i < spans.length; i++) {
    const next = spans[i];
    if (next.start <= current.end) {
      // Overlapping or touching spans -> merge
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push({ start: current.start, end: current.end });
      current = { ...next };
    }
  }
  merged.push({ start: current.start, end: current.end });

  return { spans: merged, linkCount };
}

/**
 * Cleans a Telegram message text/caption and its entities.
 *
 * @param {string} text Original message text or caption
 * @param {Array<object>} [entities=[]] Original message entities
 * @param {Array<string|object>} [signatureRules=[]] Literal signature rules to strip
 * @param {object} [options={}] Options { removeLinks: true, stripSignatures: true, preserveEntities: true }
 * @returns {{
 *   cleanedText: string,
 *   cleanedEntities: Array<object>,
 *   removedLinkCount: number,
 *   shouldSkip: boolean,
 *   skipReason?: string
 * }}
 */
export function cleanMessage(text, entities = [], signatureRules = [], options = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return {
      cleanedText: '',
      cleanedEntities: [],
      removedLinkCount: 0,
      shouldSkip: true,
      skipReason: 'EMPTY_TEXT',
    };
  }

  const { spans, linkCount } = findDeletionSpans(text, entities, signatureRules, options);

  // Remap entities based on the deleted spans
  let remappedEntities = [];
  if (options.preserveEntities !== false && Array.isArray(entities) && entities.length > 0) {
    remappedEntities = remapEntities(entities, spans);
  }

  // Slice out the deleted spans from text
  let cleanedText = '';
  let lastIndex = 0;
  for (const span of spans) {
    if (span.start > lastIndex) {
      cleanedText += text.slice(lastIndex, span.start);
    }
    lastIndex = Math.max(lastIndex, span.end);
  }
  if (lastIndex < text.length) {
    cleanedText += text.slice(lastIndex);
  }

  // Calculate whitespace adjustments for leading spaces and multi-newline collapses
  const originalCleaned = cleanedText;

  // Trim leading whitespace and shift entity offsets
  const leadingWhitespaceMatch = cleanedText.match(/^\s+/);
  const leadingCut = leadingWhitespaceMatch ? leadingWhitespaceMatch[0].length : 0;
  if (leadingCut > 0) {
    cleanedText = cleanedText.slice(leadingCut);
    remappedEntities = remappedEntities
      .map((e) => ({ ...e, offset: e.offset - leadingCut }))
      .filter((e) => e.offset >= 0);
  }

  // Trim trailing whitespace
  cleanedText = cleanedText.trimEnd();

  // Collapse 3+ newlines to 2 newlines (\n\n)
  const newlineCollapsed = cleanedText.replace(/\n{3,}/g, '\n\n');
  if (newlineCollapsed !== cleanedText) {
    // If collapsing newlines occurred, adjust entities or validate bounds
    cleanedText = newlineCollapsed;
  }

  // Final check: is there any useful content remaining?
  if (cleanedText.trim().length === 0) {
    return {
      cleanedText: '',
      cleanedEntities: [],
      removedLinkCount: linkCount,
      shouldSkip: true,
      skipReason: 'EMPTY_AFTER_CLEANING',
    };
  }

  // Validate all remaining entities are strictly inside text bounds
  const validEntities = validateEntitiesInBounds(cleanedText, remappedEntities);

  return {
    cleanedText,
    cleanedEntities: validEntities,
    removedLinkCount: linkCount,
    shouldSkip: false,
  };
}
