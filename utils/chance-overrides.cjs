const { createJsonStore } = require('./json-store.cjs');

/*
 * Streamer-edited chances, by key, persisted so they survive a restart
 * without ever touching the shipped *.data.json files. Stored as
 * { key: fraction 0-1 } in its own file under ~/.gamma-slot-machine/.
 */

function createChanceOverrides(filename) {
  const store = createJsonStore(filename, {});

  return {
    // The override for `key`, or undefined when there isn't one.
    get(key) {
      const value = store.read()[key];

      return typeof value === 'number' ? value : undefined;
    },

    set(key, chance) {
      const clamped = Math.max(0, Math.min(1, Number(chance) || 0));

      store.write({ ...store.read(), [key]: clamped });
    },

    clear() {
      store.write({});
    },
  };
}

module.exports = { createChanceOverrides };
