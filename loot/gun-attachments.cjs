const { createJsonStore } = require('../utils/json-store.cjs');

/*
 * ---------------------------------------------------------
 * "Roll guns with attachments" bonus
 * ---------------------------------------------------------
 * A loot roll that includes a weapon has a flat CHANCE of giving it with
 * a scope and/or silencer already attached — the game side
 * (zzzzzz_slot_machine_bridge.script) works out which ones actually fit
 * the rolled weapon from its own ini config. On by default; persisted
 * the same way as reward-settings.json's autoActivate.
 */

const CHANCE = 0.25;

const store = createJsonStore('gun-attachments.json', { enabled: true });

function isEnabled() {
  return Boolean(store.read().enabled);
}

function setEnabled(enabled) {
  store.write({ enabled: Boolean(enabled) });
}

module.exports = { CHANCE, isEnabled, setEnabled };
