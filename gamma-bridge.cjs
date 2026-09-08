const fs = require('fs');
const path = require('path');

/*
 * ---------------------------------------------------------
 * GAMMA PATH
 * ---------------------------------------------------------
 * The bridge writes newline-separated commands into
 * command.txt inside the mod folder. The in-game Lua side
 * (add_weapon.script) polls that file every ~2s.
 *
 *   WEAPON|<item_id>|<ammo_ids>
 *   OUTFIT|<item_id>
 *   HELMET|<item_id>
 */

const MOD_FOLDER = 'GAMMA Weapon and Armor Slot Machine by rip_perri';

function getCommandFile(gammaPath) {
  return path.join(
    gammaPath,
    'mods',
    MOD_FOLDER,
    'gamedata',
    'scripts',
    'bridge',
    'command.txt',
  );
}

function isValidGammaPath(gammaPath) {
  if (!gammaPath) {
    return false;
  }

  return fs.existsSync(getCommandFile(gammaPath));
}

/*
 * Try to automatically find GAMMA on any Windows drive.
 */
function findGamma() {
  // Drive letters C: (67) .. Z: (90)
  for (let i = 67; i <= 90; i++) {
    const drive = `${String.fromCharCode(i)}:\\`;

    if (!fs.existsSync(drive)) {
      continue;
    }

    const gammaPath = path.join(drive, 'GAMMA');

    if (isValidGammaPath(gammaPath)) {
      return gammaPath;
    }
  }

  return null;
}

/*
 * Resolve GAMMA fresh each time — the user may launch the
 * game after the server is already running.
 */
function getGammaPath() {
  return findGamma();
}

/*
 * ---------------------------------------------------------
 * COMMAND BUILDING / WRITING
 * ---------------------------------------------------------
 */

/*
 * Turn a { weapons, outfits, helmets } payload into command
 * lines. Each entry needs an `itemId`; weapons may carry `ammo`.
 */
function buildCommandLines({ weapons, outfits, helmets } = {}) {
  const lines = [];

  if (Array.isArray(weapons)) {
    for (const weapon of weapons) {
      if (!weapon || !weapon.itemId) {
        continue;
      }

      lines.push(`WEAPON|${weapon.itemId}|${weapon.ammo || ''}`);
    }
  }

  if (Array.isArray(outfits)) {
    for (const outfit of outfits) {
      if (!outfit || !outfit.itemId) {
        continue;
      }

      lines.push(`OUTFIT|${outfit.itemId}`);
    }
  }

  if (Array.isArray(helmets)) {
    for (const helmet of helmets) {
      if (!helmet || !helmet.itemId) {
        continue;
      }

      lines.push(`HELMET|${helmet.itemId}`);
    }
  }

  return lines;
}

/*
 * Write command lines to GAMMA's command.txt.
 * Returns { ok, error?, command?, gammaPath? }.
 */
function writeCommandLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, error: 'No commands to write' };
  }

  const gammaPath = getGammaPath();

  if (!gammaPath) {
    return { ok: false, error: 'GAMMA installation not found' };
  }

  const commandFile = getCommandFile(gammaPath);
  const command = lines.join('\n');

  try {
    fs.writeFileSync(commandFile, command, 'utf8');
  } catch (error) {
    return { ok: false, error: `Failed to write command file: ${error.message}` };
  }

  return { ok: true, command, gammaPath };
}

/*
 * Convenience: build + write in one call.
 */
function giveLoadout(payload) {
  return writeCommandLines(buildCommandLines(payload));
}

module.exports = {
  MOD_FOLDER,
  getCommandFile,
  isValidGammaPath,
  findGamma,
  getGammaPath,
  buildCommandLines,
  writeCommandLines,
  giveLoadout,
};
