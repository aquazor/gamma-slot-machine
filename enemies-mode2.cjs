/*
 * Dual-slot spawn — normal roster. See spawn-mode.cjs for the actual
 * engine; this just binds it to the normal data file and its own
 * bonus-chance override file. enemies-labs.cjs is the other instance.
 */

const { createSpawnMode } = require('./spawn-mode.cjs');

module.exports = createSpawnMode({
  data: require('./enemies.mode2.data.json'),
  overridesFile: 'bonus-chance-overrides.json',
});
