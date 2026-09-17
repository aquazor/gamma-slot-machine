const fs = require('fs');
const os = require('os');
const path = require('path');
const { isSea, getAsset } = require('node:sea');

/*
 * ---------------------------------------------------------
 * GAMMA PATH
 * ---------------------------------------------------------
 * The bridge writes newline-separated commands into
 * command.txt inside the mod folder. The in-game Lua side
 * (slot_machine_bridge.script) polls that file every ~2s.
 *
 *   WEAPON|<item_id>|<ammo_ids>
 *   OUTFIT|<item_id>
 *   HELMET|<item_id>
 */

const MOD_NAME = 'GAMMA Randomizer Slot Machine by rip_perri';

function getCommandFile(gammaPath) {
  return path.join(
    gammaPath,
    'mods',
    MOD_NAME,
    'gamedata',
    'scripts',
    'bridge',
    'command.txt',
  );
}

/*
 * Structural check, not "our mod is installed here" — a folder is a
 * GAMMA/MO2 instance if it has a `mods` dir and MO2 itself (GAMMA
 * ships a portable MO2 build inside its own folder). Needs to work
 * before our mod ever gets installed, since it's also used to locate
 * the sibling Anomaly folder.
 */
function isValidGammaPath(gammaPath) {
  if (!gammaPath || !fs.existsSync(path.join(gammaPath, 'mods'))) {
    return false;
  }

  return (
    fs.existsSync(path.join(gammaPath, 'ModOrganizer.exe')) ||
    fs.existsSync(path.join(gammaPath, 'ModOrganizer.ini'))
  );
}

/*
 * A folder is a real Anomaly install if it has `gamedata` and a
 * `bin` containing the game exe.
 */
function isValidAnomalyPath(anomalyPath) {
  if (!anomalyPath || !fs.existsSync(path.join(anomalyPath, 'gamedata'))) {
    return false;
  }

  const binPath = path.join(anomalyPath, 'bin');

  try {
    return fs.readdirSync(binPath).some((name) => /^anomaly.*\.exe$/i.test(name));
  } catch {
    return false;
  }
}

/*
 * ---------------------------------------------------------
 * PATH OVERRIDES
 * ---------------------------------------------------------
 * Manual GAMMA/Anomaly paths the user set from Settings, for the
 * cases auto-detection can't cover (installed deeper than a couple
 * folder levels, or GAMMA and Anomaly on different drives). Stored
 * next to the other user-data overrides (twitch-rewards.cjs).
 */

const PATHS_OVERRIDE_FILE = path.join(os.homedir(), '.gamma-slot-machine', 'paths.json');

function loadPathOverrides() {
  try {
    return JSON.parse(fs.readFileSync(PATHS_OVERRIDE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function savePathOverrides(overrides) {
  const dir = path.dirname(PATHS_OVERRIDE_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(PATHS_OVERRIDE_FILE, JSON.stringify(overrides, null, 2), 'utf8');
}

function getPathOverrides() {
  return loadPathOverrides();
}

function setPathOverrides({ gammaPath, anomalyPath } = {}) {
  const next = { ...loadPathOverrides() };

  if (gammaPath !== undefined) {
    next.gammaPath = gammaPath || undefined;
  }

  if (anomalyPath !== undefined) {
    next.anomalyPath = anomalyPath || undefined;
  }

  for (const key of Object.keys(next)) {
    if (!next[key]) {
      delete next[key];
    }
  }

  savePathOverrides(next);

  return next;
}

function clearPathOverrides() {
  savePathOverrides({});
}

/*
 * Breadth-first scan (shallowest match wins) for a folder literally
 * named `targetName`, under each present drive root, up to `maxDepth`
 * levels deep. Depth 0 covers the ~95% case (folder sits at the drive
 * root); depth 1 also catches a one-level wrapper folder (e.g. a
 * G.A.M.M.A\ parent) without crawling the whole drive.
 */
function scanDrivesForFolder(targetName, validate, maxDepth) {
  const targetLower = targetName.toLowerCase();

  for (let i = 67; i <= 90; i++) {
    const drive = `${String.fromCharCode(i)}:\\`;

    if (!fs.existsSync(drive)) {
      continue;
    }

    let frontier = [drive];

    for (let depth = 0; depth <= maxDepth; depth++) {
      const nextFrontier = [];

      for (const dir of frontier) {
        let entries;

        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }

          const fullPath = path.join(dir, entry.name);

          if (entry.name.toLowerCase() === targetLower && validate(fullPath)) {
            return fullPath;
          }

          nextFrontier.push(fullPath);
        }
      }

      frontier = nextFrontier;
    }
  }

  return null;
}

/*
 * Resolve GAMMA fresh each time — the user may launch the
 * game after the server is already running.
 */
function findGamma() {
  const override = loadPathOverrides().gammaPath;

  if (isValidGammaPath(override)) {
    return override;
  }

  return scanDrivesForFolder('GAMMA', isValidGammaPath, 1);
}

function getGammaPath() {
  return findGamma();
}

/*
 * Anomaly usually sits right next to GAMMA (same parent folder), so
 * that's tried first once GAMMA is found — cheap, and covers "deeper
 * than the drive root" for free since it inherits wherever GAMMA was
 * found. Falls back to an independent drive scan for the "GAMMA and
 * Anomaly are on different drives" case.
 */
function findAnomaly() {
  const override = loadPathOverrides().anomalyPath;

  if (isValidAnomalyPath(override)) {
    return override;
  }

  const gammaPath = findGamma();

  if (gammaPath) {
    const sibling = path.join(path.dirname(gammaPath), 'Anomaly');

    if (isValidAnomalyPath(sibling)) {
      return sibling;
    }
  }

  return scanDrivesForFolder('Anomaly', isValidAnomalyPath, 1);
}

function getAnomalyPath() {
  return findAnomaly();
}

/*
 * ---------------------------------------------------------
 * COMMAND BUILDING / WRITING
 * ---------------------------------------------------------
 */

/*
 * Turn a { weapons, outfits, helmets, message } payload into
 * command lines. Each item entry needs an `itemId`; weapons may
 * carry `ammo`. `message`, if given, becomes a green `MSG|loot|`
 * line shown in the PDA corner in-game.
 */
function buildCommandLines({ weapons, outfits, helmets, message } = {}) {
  const lines = [];

  if (typeof message === 'string' && message.trim()) {
    lines.push(`MSG|loot|${message.trim()}`);
  }

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

function getAnomalyCommandFile(anomalyPath) {
  return path.join(anomalyPath, 'gamedata', 'scripts', 'bridge', 'command.txt');
}

/*
 * Whichever of the two possible install locations actually has the
 * mod's command.txt wins: the direct Anomaly/gamedata install (from
 * the Settings install button) if present, else the legacy manual
 * GAMMA\mods\<name> install, for players who dropped the mod in as a
 * regular MO2 mod instead.
 */
function resolveCommandFile() {
  const anomalyPath = getAnomalyPath();

  if (anomalyPath) {
    const directFile = getAnomalyCommandFile(anomalyPath);

    if (fs.existsSync(directFile)) {
      return directFile;
    }
  }

  const gammaPath = getGammaPath();

  if (gammaPath) {
    const legacyFile = getCommandFile(gammaPath);

    if (fs.existsSync(legacyFile)) {
      return legacyFile;
    }
  }

  return null;
}

/*
 * Write command lines to whichever command.txt the mod is actually
 * installed at. Returns { ok, error?, command?, commandFile? }.
 */
function writeCommandLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, error: 'No commands to write' };
  }

  const commandFile = resolveCommandFile();

  if (!commandFile) {
    return { ok: false, error: 'GAMMA installation not found' };
  }

  const command = lines.join('\n');

  try {
    // Append, don't overwrite: the Lua side's poll loop (actor_on_update)
    // doesn't run at all while a level is still loading, so an earlier
    // delivery can still be sitting unread in the file. Appending means a
    // second delivery during that window queues up alongside it instead
    // of clobbering it outright — the Lua side already reads and
    // processes every line in the file in one pass (see check_bridge in
    // GAMMA MOD/gamedata/scripts/slot_machine_bridge.script), so nothing
    // else needs to change there. A leading blank line before the first
    // write is harmless — it's just skipped.
    fs.appendFileSync(commandFile, `\n${command}`, 'utf8');
  } catch (error) {
    return { ok: false, error: `Failed to write command file: ${error.message}` };
  }

  return { ok: true, command, commandFile };
}

/*
 * Convenience: build + write in one call.
 */
function giveLoadout(payload) {
  return writeCommandLines(buildCommandLines(payload));
}

/*
 * ---------------------------------------------------------
 * DIRECT INSTALL (Anomaly/gamedata)
 * ---------------------------------------------------------
 * Copies the mod straight into Anomaly's real gamedata folder instead
 * of GAMMA\mods\<name>\gamedata. The game then finds it whether
 * launched through MO2/the GAMMA launcher (the real gamedata is still
 * visible underneath any mod overlay) or the exe directly (no MO2
 * virtualization at all, so only the real gamedata is ever read).
 *
 * Manual GAMMA\mods installs keep working — see resolveCommandFile()
 * above. This is opt-in only, triggered from Settings; nothing here
 * runs automatically on app start.
 */

// Relative to GAMMA MOD/gamedata/. Always overwritten on install/
// update — they're static mod code/assets, never touched at runtime.
const STATIC_MOD_FILES = ['scripts/slot_machine_bridge.script', 'sounds/spawn.ogg'];

// Created empty if missing, but never overwritten — it's the live
// runtime queue, and clobbering it on every reinstall/update would
// discard whatever's mid-flight (see the "append, don't overwrite"
// note in writeCommandLines).
const COMMAND_FILE_RELATIVE = 'scripts/bridge/command.txt';

function toDestSegments(relativePath) {
  return relativePath.split('/');
}

function readModSourceFile(relativePath) {
  if (isSea()) {
    return Buffer.from(getAsset(`mod-gamedata/${relativePath}`));
  }

  return fs.readFileSync(path.join(__dirname, 'GAMMA MOD', 'gamedata', ...toDestSegments(relativePath)));
}

function getAnomalyGamedataPath(anomalyPath) {
  return path.join(anomalyPath, 'gamedata');
}

function getModStatus() {
  const anomalyPath = getAnomalyPath();

  if (!anomalyPath) {
    return { installed: 'unknown', anomalyPath: null };
  }

  const gamedataPath = getAnomalyGamedataPath(anomalyPath);
  const allRelative = [...STATIC_MOD_FILES, COMMAND_FILE_RELATIVE];
  const presentCount = allRelative.filter((relativePath) =>
    fs.existsSync(path.join(gamedataPath, ...toDestSegments(relativePath))),
  ).length;

  let installed;

  if (presentCount === 0) {
    installed = 'not-installed';
  } else if (presentCount === allRelative.length) {
    installed = 'installed';
  } else {
    installed = 'partial';
  }

  return { installed, anomalyPath };
}

function installMod() {
  const anomalyPath = getAnomalyPath();

  if (!anomalyPath) {
    return { ok: false, error: 'Anomaly installation not found' };
  }

  const gamedataPath = getAnomalyGamedataPath(anomalyPath);

  try {
    for (const relativePath of STATIC_MOD_FILES) {
      const destPath = path.join(gamedataPath, ...toDestSegments(relativePath));

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, readModSourceFile(relativePath));
    }

    const commandDest = path.join(gamedataPath, ...toDestSegments(COMMAND_FILE_RELATIVE));

    fs.mkdirSync(path.dirname(commandDest), { recursive: true });

    if (!fs.existsSync(commandDest)) {
      fs.writeFileSync(commandDest, '', 'utf8');
    }
  } catch (error) {
    return { ok: false, error: `Failed to install: ${error.message}` };
  }

  return { ok: true, anomalyPath };
}

function uninstallMod() {
  const anomalyPath = getAnomalyPath();

  if (!anomalyPath) {
    return { ok: false, error: 'Anomaly installation not found' };
  }

  const gamedataPath = getAnomalyGamedataPath(anomalyPath);
  const allRelative = [...STATIC_MOD_FILES, COMMAND_FILE_RELATIVE];

  try {
    for (const relativePath of allRelative) {
      const destPath = path.join(gamedataPath, ...toDestSegments(relativePath));

      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
    }

    // Only remove bridge/ if it ended up empty — never touch it if
    // something unrelated is sitting in there.
    const bridgeDir = path.join(gamedataPath, 'scripts', 'bridge');

    if (fs.existsSync(bridgeDir) && fs.readdirSync(bridgeDir).length === 0) {
      fs.rmdirSync(bridgeDir);
    }
  } catch (error) {
    return { ok: false, error: `Failed to uninstall: ${error.message}` };
  }

  return { ok: true, anomalyPath };
}

module.exports = {
  MOD_NAME,
  getCommandFile,
  isValidGammaPath,
  isValidAnomalyPath,
  findGamma,
  getGammaPath,
  getAnomalyPath,
  buildCommandLines,
  writeCommandLines,
  giveLoadout,
  getModStatus,
  installMod,
  uninstallMod,
  getPathOverrides,
  setPathOverrides,
  clearPathOverrides,
};
