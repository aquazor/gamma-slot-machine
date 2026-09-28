const fs = require('fs');
const os = require('os');
const path = require('path');

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

const SETTINGS_PATH = path.join(os.homedir(), '.gamma-slot-machine', 'gun-attachments.json');

function isEnabled() {
  try {
    return Boolean(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')).enabled);
  } catch {
    return true;
  }
}

function setEnabled(enabled) {
  const dir = path.dirname(SETTINGS_PATH);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    SETTINGS_PATH,
    JSON.stringify({ enabled: Boolean(enabled) }, null, 2),
    'utf8',
  );
}

module.exports = { CHANCE, isEnabled, setEnabled };
