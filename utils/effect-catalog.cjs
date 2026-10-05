const { createChanceOverrides } = require('./chance-overrides.cjs');
const { createKeyToggles } = require('./key-toggles.cjs');
const { pickWeightedIndex } = require('./weighted.cjs');

/*
 * The roster logic positive-effects.cjs and negative-effects.cjs share: a
 * flat { key: def } data file (underscore keys are metadata) where each
 * def has a relative roll `chance`, the streamer can switch entries on/off
 * (runtime-only) and edit their chance (persisted in `overridesFile`).
 */

function createEffectCatalog({ data, overridesFile }) {
  const toggles = createKeyToggles();
  const overrides = createChanceOverrides(overridesFile);

  function keys() {
    return Object.keys(data).filter((key) => !key.startsWith('_'));
  }

  function def(key) {
    return data[key] || null;
  }

  // Relative weight: the streamer's override, else the data file's own
  // `chance`, else 1 (an entry with no `chance` weighs the same as the rest).
  function chanceOf(key) {
    const override = overrides.get(key);

    if (override !== undefined) {
      return override;
    }

    const entry = def(key);

    return entry && Number.isFinite(entry.chance) ? entry.chance : 1;
  }

  // One enabled key by relative chance (a disabled key's share is
  // redistributed over what's left); null when everything is disabled.
  function rollKey() {
    const enabled = keys().filter((key) => toggles.isEnabled(key));

    if (enabled.length === 0) {
      return null;
    }

    const weights = enabled.map((key) => Math.max(0, chanceOf(key)));

    return enabled[pickWeightedIndex(weights)];
  }

  // "Restore defaults": re-enable everything and drop every chance override.
  function reset() {
    toggles.enableAll();
    overrides.clear();
  }

  return {
    keys,
    def,
    chanceOf,
    isEnabled: toggles.isEnabled,
    setEnabled: toggles.setEnabled,
    setChance: overrides.set,
    rollKey,
    reset,
  };
}

module.exports = { createEffectCatalog };
