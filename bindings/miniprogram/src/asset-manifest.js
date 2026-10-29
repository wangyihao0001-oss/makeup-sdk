const PATTERN_GROUP = Object.freeze({
  lipstick: 'pattern:lipstick',
  mascara: 'pattern:mascara',
  eyeliner: 'pattern:eyeline',
  eyeshadow: 'pattern:eyeshadow',
  blush: 'pattern:blush',
  foundation: 'pattern:foundation'
});

/**
 * Files needed to start tracking plus the shaders and patterns for the
 * given effect categories. FaceMesh, the face model and the pattern catalog
 * are included once; other categories stay unloaded until requested.
 */
export function assetPathsForCategories(manifest, categories = []) {
  const groups = new Set(['faceMesh', 'model', 'catalog']);
  for (const category of categories) {
    groups.add(`shader:${category}`);
    if (PATTERN_GROUP[category]) groups.add(PATTERN_GROUP[category]);
  }
  return (manifest?.files ?? []).filter((file) => groups.has(file.group)).map((file) => file.path);
}
