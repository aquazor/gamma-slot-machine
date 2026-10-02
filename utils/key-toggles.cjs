/*
 * Runtime-only on/off switches by key (perks, negative effects, spawn
 * bonuses...) — everything is enabled until switched off, and the state
 * resets on server restart.
 */

function createKeyToggles() {
  const disabled = new Set();

  return {
    isEnabled(key) {
      return !disabled.has(key);
    },

    setEnabled(key, enabled) {
      if (enabled) {
        disabled.delete(key);
      } else {
        disabled.add(key);
      }
    },

    enableAll() {
      disabled.clear();
    },
  };
}

module.exports = { createKeyToggles };
