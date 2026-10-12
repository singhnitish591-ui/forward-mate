// tgcloud/lib/entities.js
// Forward Mate — UTF-16 Code-Unit Safe Telegram Entity Remapper.
//
// Telegram Bot API defines entity offsets and lengths in UTF-16 code units.
// In JavaScript, string indexing (str.length, substring, slice) is natively
// based on UTF-16 code units (surrogate pairs like emojis occupy length 2).

/**
 * Calculates new offsets and lengths for Telegram message entities
 * after a list of non-overlapping deletion spans [start, end) have been removed from text.
 *
 * @param {Array<object>} entities Original Telegram entities
 * @param {Array<{start: number, end: number}>} removedSpans Sorted non-overlapping [start, end) spans in UTF-16 units
 * @returns {Array<object>} Remapped valid entities
 */
export function remapEntities(entities, removedSpans) {
  if (!Array.isArray(entities) || entities.length === 0) {
    return [];
  }
  if (!Array.isArray(removedSpans) || removedSpans.length === 0) {
    return entities.map((e) => ({ ...e }));
  }

  // Sort removed spans by start ascending
  const sortedSpans = [...removedSpans].sort((a, b) => a.start - b.start);

  const remapped = [];

  for (const entity of entities) {
    // Drop URL and text_link entities completely
    if (entity.type === 'url' || entity.type === 'text_link') {
      continue;
    }

    const entStart = entity.offset;
    const entEnd = entity.offset + entity.length;

    let newStart = entStart;
    let newEnd = entEnd;
    let dropEntity = false;

    for (const span of sortedSpans) {
      if (span.end <= entStart) {
        // Deletion span is entirely BEFORE this entity -> shift start and end left
        const delta = span.end - span.start;
        newStart -= delta;
        newEnd -= delta;
      } else if (span.start >= entEnd) {
        // Deletion span is entirely AFTER this entity -> no effect on this entity
        continue;
      } else if (span.start <= entStart && span.end >= entEnd) {
        // Deletion span completely COVERS this entity -> drop entity
        dropEntity = true;
        break;
      } else {
        // Partial overlap: trim the entity boundaries
        if (span.start <= entStart && span.end < entEnd) {
          // Span overlaps the start of the entity
          const cutInside = span.end - entStart;
          const totalCutBefore = span.end - span.start;
          newStart -= span.start < entStart ? entStart - span.start : 0;
          newEnd -= totalCutBefore;
        } else if (span.start > entStart && span.end >= entEnd) {
          // Span overlaps the end of the entity
          const cutInside = entEnd - span.start;
          newEnd -= cutInside;
        } else if (span.start > entStart && span.end < entEnd) {
          // Span is strictly inside the entity
          const delta = span.end - span.start;
          newEnd -= delta;
        }
      }
    }

    if (!dropEntity && newEnd > newStart) {
      remapped.push({
        ...entity,
        offset: newStart,
        length: newEnd - newStart,
      });
    }
  }

  return remapped;
}

/**
 * Validates that all entities fit within the bounds of text.
 *
 * @param {string} text
 * @param {Array<object>} entities
 * @returns {Array<object>} Valid entities within bounds
 */
export function validateEntitiesInBounds(text, entities) {
  if (!text || !Array.isArray(entities)) return [];
  const textLength = text.length;

  return entities.filter(
    (e) =>
      typeof e.offset === 'number' &&
      typeof e.length === 'number' &&
      e.offset >= 0 &&
      e.length > 0 &&
      e.offset + e.length <= textLength
  );
}
