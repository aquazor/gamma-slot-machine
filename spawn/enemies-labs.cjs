/*
 * Dual-slot spawn — "Count Roll (labs)" roster. Same engine as
 * enemies-mode2.cjs (see spawn-mode.cjs), bound to enemies.labs.data.json
 * instead: Monolith/UNISG/Sin are available at every tier here (not
 * Expert-only), and the mutant roster can be trimmed independently of
 * the normal one. Its own bonus-chance overrides, separate from the
 * normal roster's — faction on/off toggles are still shared (see
 * enemy-pool.cjs's module-level factionToggles).
 */

const { createSpawnMode } = require('./spawn-mode.cjs');

module.exports = createSpawnMode({
  data: require('./enemies.labs.data.json'),
  overridesFile: 'bonus-chance-overrides-labs.json',
});
