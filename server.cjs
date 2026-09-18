const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { isSea, getAsset } = require('node:sea');
const { exec, execFile } = require('child_process');
const twitchAuth = require('./twitch-auth.cjs');
const { TwitchEventSub } = require('./twitch-eventsub.cjs');
const { Roulette } = require('./roulette.cjs');
const rewards = require('./twitch-rewards.cjs');
const bridge = require('./gamma-bridge.cjs');
const enemies = require('./enemies.cjs');
const enemiesMode2 = require('./enemies-mode2.cjs');
const perks = require('./positive-effects.cjs');

const { getGammaPath, MOD_NAME } = bridge;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
};

const app = express();
const PORT = 7770;

app.use(cors());
app.use(express.json());

/*
 * ---------------------------------------------------------
 * GAMMA API
 * ---------------------------------------------------------
 * GAMMA path detection + command.txt writing lives in
 * gamma-bridge.cjs (shared with roulette.cjs).
 */

app.get('/gamma', (req, res) => {
  const gammaPath = getGammaPath();

  res.json({
    configured: Boolean(gammaPath),
    gammaPath,
  });
});

/*
 * ---------------------------------------------------------
 * MOD INSTALL (Anomaly/gamedata)
 * ---------------------------------------------------------
 * Manual install/uninstall from Settings, plus manual path overrides
 * for the cases auto-detection can't cover. See gamma-bridge.cjs.
 */

app.get('/mod/status', (req, res) => {
  const gammaPath = getGammaPath();
  const status = bridge.getModStatus();
  const overrides = bridge.getPathOverrides();

  res.json({
    gammaPath,
    anomalyPath: status.anomalyPath,
    installed: status.installed,
    overrides,
  });
});

app.post('/mod/install', (req, res) => {
  const result = bridge.installMod();

  if (!result.ok) {
    console.warn(`Mod install failed: ${result.error}`);

    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, anomalyPath: result.anomalyPath });
});

app.post('/mod/uninstall', (req, res) => {
  const result = bridge.uninstallMod();

  if (!result.ok) {
    console.warn(`Mod uninstall failed: ${result.error}`);

    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, anomalyPath: result.anomalyPath });
});

app.post('/mod/paths', (req, res) => {
  const { gammaPath, anomalyPath } = req.body || {};

  if (gammaPath !== undefined && gammaPath && !bridge.isValidGammaPath(gammaPath)) {
    return res.status(400).json({ error: 'Not a valid GAMMA folder' });
  }

  if (
    anomalyPath !== undefined &&
    anomalyPath &&
    !bridge.isValidAnomalyPath(anomalyPath)
  ) {
    return res.status(400).json({ error: 'Not a valid Anomaly folder' });
  }

  const overrides = bridge.setPathOverrides({ gammaPath, anomalyPath });

  res.json({ success: true, overrides });
});

/*
 * ---------------------------------------------------------
 * NATIVE FOLDER PICKER
 * ---------------------------------------------------------
 * A browser's <input type="file" webkitdirectory> deliberately hides the
 * real absolute path for security, so it's useless for telling this
 * Node process where GAMMA/Anomaly actually live on disk. The only way
 * to get a real Windows folder-picker dialog without an Electron/native
 * shell is to ask Windows itself for one — so this spawns `powershell.exe`
 * and asks it to show the built-in .NET FolderBrowserDialog, then reads
 * back whatever path the user picked (or nothing, if they cancelled).
 *
 * What actually runs, spelled out (see WINFORMS_FOLDER_PICKER_SCRIPT):
 *   1. Loads the standard .NET System.Windows.Forms assembly (ships with
 *      every Windows install; this is the same DLL Windows' own Explorer
 *      and countless other apps use for dialogs).
 *   2. Opens a FolderBrowserDialog — a plain "choose a folder" window,
 *      nothing else on screen, no network access, no file writes.
 *   3. Prints the chosen path to stdout if the user clicked OK; prints
 *      nothing if they cancelled.
 * `kind` only ever selects one of the two fixed description strings
 * below — no request data is ever interpolated into the script, so
 * there's no injection surface here.
 */
const WINFORMS_FOLDER_PICKER_SCRIPT = (description) =>
  [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    `$dialog.Description = '${description}'`,
    '$result = $dialog.ShowDialog()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }',
  ].join('; ');

app.post('/mod/browse-folder', (req, res) => {
  const { kind } = req.body || {};
  const description = kind === 'anomaly' ? 'Select your Anomaly folder' : 'Select your GAMMA folder';

  execFile(
    'powershell.exe',
    ['-NoProfile', '-STA', '-Command', WINFORMS_FOLDER_PICKER_SCRIPT(description)],
    { timeout: 5 * 60 * 1000 },
    (error, stdout) => {
      if (error) {
        // Most likely PowerShell isn't available at all (e.g. a
        // stripped-down Windows build, or the app running under Wine on
        // Linux) — surface that instead of silently doing nothing, so
        // the streamer knows to type the path in by hand instead.
        console.warn(`Folder picker failed: ${error.message}`);

        return res.json({ path: null, error: 'Could not open the folder picker' });
      }

      const selected = (stdout || '').toString().trim();

      res.json({ path: selected || null });
    },
  );
});

app.post('/mod/paths/reset', (req, res) => {
  bridge.clearPathOverrides();

  res.json({ success: true });
});

/*
 * ---------------------------------------------------------
 * GIVE ITEM
 * ---------------------------------------------------------
 */

app.post('/give-loadout', (req, res) => {
  const { weapons, outfits, helmets } = req.body;

  if (!Array.isArray(weapons) && !Array.isArray(outfits) && !Array.isArray(helmets)) {
    return res.status(400).json({
      error: 'weapons, outfits, or helmets are required',
    });
  }

  const lines = bridge.buildCommandLines({ weapons, outfits, helmets });

  if (lines.length === 0) {
    return res.status(400).json({ error: 'Loadout is empty' });
  }

  const result = bridge.writeCommandLines(lines);

  if (!result.ok) {
    const status = result.error === 'GAMMA installation not found' ? 400 : 500;

    return res.status(status).json({ error: result.error });
  }

  console.log('Loadout sent to GAMMA:');
  console.log(result.command);
  console.log('----------------------------------------');

  res.json({
    success: true,
    loadout: {
      weapons: weapons || [],
      outfits: outfits || [],
      helmets: helmets || [],
    },
  });
});

/*
 * ---------------------------------------------------------
 * TWITCH AUTH
 * ---------------------------------------------------------
 */

// in-memory state for an in-progress device code flow
let pendingDeviceFlow = null;

/*
 * EventSub client — a single long-lived connection to Twitch.
 * For now it just logs incoming events; roulette.cjs will
 * consume them later.
 */
const eventSub = new TwitchEventSub();

eventSub.on('connected', () => {
  console.log(`Twitch EventSub connected`);
});

eventSub.on('subscribed', (types) => {
  console.log(`Twitch EventSub subscribed to: ${types.join(', ') || 'nothing'}`);
});

eventSub.on('reconnected', () => {
  console.log('Twitch EventSub reconnected');
});

eventSub.on('disconnected', ({ code, reason }) => {
  console.log(`Twitch EventSub disconnected (${code} ${reason})`);
});

eventSub.on('revocation', (subscription) => {
  console.warn(`Twitch EventSub subscription revoked: ${subscription.type}`);
});

eventSub.on('error', (error) => {
  console.error('Twitch EventSub:', error.message);
});

async function startEventSub() {
  try {
    await eventSub.start();
  } catch (error) {
    console.error('Failed to start Twitch EventSub:', error.message);
  }
}

/*
 * True from boot (or from the moment Twitch connects) until the reward
 * sync it triggers has settled. The reward list on Twitch can lag a
 * moment behind what CHANNEL_POINT_REWARDS + overrides say it should be
 * (e.g. re-enabling everything on restart) — exposed via GET
 * /twitch/rewards so the Settings page can wait/retry instead of
 * rendering a stale snapshot right after the server starts.
 */
let rewardsSyncing = true;

/*
 * Create / sync the channel-point rewards and hand the id -> definition
 * map to the roulette so redemptions can trigger rolls.
 */
async function syncRewards() {
  rewardsSyncing = true;

  try {
    const map = await rewards.ensureRewards();

    roulette.setRewardMap(map);

    console.log(`Channel-point rewards ready: ${map.size}`);
  } catch (error) {
    console.error('Failed to sync channel-point rewards:', error.message);
  } finally {
    rewardsSyncing = false;
  }
}

/*
 * Called on server startup and on a fresh Twitch connect. Only actually
 * creates/force-enables rewards if the streamer opted into "auto-activate"
 * in Settings — otherwise just reads whatever's currently live on Twitch
 * (read-only) so redemptions keep routing without silently re-enabling
 * something the streamer had turned off in a previous session.
 */
async function syncOrLoadRewards() {
  if (rewards.getAutoActivate()) {
    return syncRewards();
  }

  rewardsSyncing = true;

  try {
    const map = await rewards.buildRewardMap();

    roulette.setRewardMap(map);

    console.log(`Channel-point rewards loaded (auto-activate off): ${map.size}`);
  } catch (error) {
    console.error('Failed to load channel-point rewards:', error.message);
  } finally {
    rewardsSyncing = false;
  }
}

/*
 * ---------------------------------------------------------
 * ROULETTE + OVERLAY (SSE)
 * ---------------------------------------------------------
 */

const roulette = new Roulette();

// Connected overlay clients (Server-Sent Events).
const overlayClients = new Set();

function broadcastOverlay(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of overlayClients) {
    client.write(payload);
  }
}

eventSub.on('event', (event) => {
  const job = roulette.handleEvent(event);

  if (job) {
    console.log(`Roulette: ${event.kind} from ${job.user} -> ${job.label}`);
  }
});

roulette.on('roll', (job) => {
  console.log(
    `Roulette: rolling ${job.id} (${job.results.map((r) => r.slot).join(', ')})`,
  );

  broadcastOverlay('roll', job);
});

roulette.on('delivered', (record) => {
  const detail =
    record.mode === 'spawn'
      ? record.spawnResults && record.spawnResults.length > 0
        ? record.spawnResults.map((r) => `${r.label} x${r.count}`).join(', ')
        : 'spawn'
      : record.results.map((r) => `${r.slot}:${r.name}`).join(', ');

  console.log(
    `Roulette: ${record.id} ${record.given ? `delivered [${detail}]` : `not delivered${record.giveError ? ` (${record.giveError})` : ''}`} (${record.reason})`,
  );

  broadcastOverlay('delivered', record);
});

roulette.on('complete', (record) => {
  console.log(`Roulette: ${record.id} finished (${record.reason})`);

  broadcastOverlay('complete', record);
});

/*
 * Overlay event stream. The OBS Browser Source connects here
 * and stays connected; jobs are pushed as they happen.
 */
app.get('/overlay/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  res.write(`event: hello\ndata: ${JSON.stringify(roulette.getState())}\n\n`);

  overlayClients.add(res);
  roulette.setOverlayPresent(true);

  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    overlayClients.delete(res);
    roulette.setOverlayPresent(overlayClients.size > 0);
  });
});

/*
 * Overlay reports all reels have landed — give the loadout now,
 * before the result screen fades.
 */
app.post('/overlay/rolled', (req, res) => {
  roulette.deliver((req.body || {}).id);

  res.json({ ok: true });
});

/*
 * Overlay reports its result screen has faded — advance the queue.
 */
app.post('/overlay/done', (req, res) => {
  roulette.finish((req.body || {}).id);

  res.json({ ok: true });
});

app.get('/roulette/status', (req, res) => {
  res.json(roulette.getState());
});

app.post('/roulette/preset', (req, res) => {
  const name = (req.body || {}).preset;

  if (!roulette.setPreset(name)) {
    return res.status(400).json({ error: `Unknown preset: ${name}` });
  }

  console.log(`Roulette preset -> ${name}`);

  res.json(roulette.getState());
});

app.post('/roulette/spawn-tier', (req, res) => {
  const name = (req.body || {}).tier;

  if (!roulette.setSpawnTier(name)) {
    return res.status(400).json({ error: `Unknown spawn tier: ${name}` });
  }

  console.log(`Roulette spawn tier -> ${name}`);

  res.json(roulette.getState());
});

app.post('/roulette/roll-mode', (req, res) => {
  const mode = (req.body || {}).mode;

  if (!roulette.setRollMode(mode)) {
    return res.status(400).json({ error: `Unknown roll mode: ${mode}` });
  }

  console.log(`Roulette roll mode -> ${mode}`);

  res.json(roulette.getState());
});

// Faction on/off toggles are deliberately SHARED between "Random" and
// "Count Roll" — disabling a squad means that real-world faction is off
// everywhere, not just in whichever mode you disabled it from (see
// enemy-pool.cjs's module-level `disabledFactions`). Only the spawn-BONUS
// state is mode-specific, since mode 1 ("Random") has no concept of
// bonuses at all — always act on whichever pool is currently active so a
// bonus toggle/chance change only ever touches Count Roll's own state.
function activeSpawnPool() {
  return roulette.rollMode === 'count-roll' ? enemiesMode2 : enemies;
}

/*
 * Which armed factions ('enemies' category) can currently be rolled —
 * a blanket on/off per faction, the same across every tier. Reflects
 * whichever roll mode ("Random" or "Count Roll") is currently active.
 */
app.get('/roulette/enemies', (req, res) => {
  res.json({ factions: activeSpawnPool().listFactions() });
});

app.post('/roulette/enemies/toggle', (req, res) => {
  const { group, enabled } = req.body || {};

  if (typeof group !== 'string' || !group) {
    return res.status(400).json({ error: 'group is required' });
  }

  activeSpawnPool().setFactionEnabled(group, Boolean(enabled));

  console.log(
    `Roulette faction "${group}" -> ${enabled ? 'enabled' : 'disabled'} (${roulette.rollMode})`,
  );

  res.json({ factions: activeSpawnPool().listFactions() });
});

/*
 * "Count Roll" mode only: the 3 global spawn-bonus toggles (double
 * count, +2, rare-upgrade). Applies across every tier that defines
 * that bonus key.
 */
app.get('/roulette/bonuses', (req, res) => {
  res.json({ bonuses: enemiesMode2.listBonuses() });
});

app.post('/roulette/bonuses/toggle', (req, res) => {
  const { key, enabled } = req.body || {};

  if (typeof key !== 'string' || !key) {
    return res.status(400).json({ error: 'key is required' });
  }

  enemiesMode2.setBonusEnabled(key, Boolean(enabled));

  console.log(`Roulette bonus "${key}" -> ${enabled ? 'enabled' : 'disabled'}`);

  res.json({ bonuses: enemiesMode2.listBonuses() });
});

app.post('/roulette/bonuses/chance', (req, res) => {
  const { key, chance } = req.body || {};

  if (typeof key !== 'string' || !key) {
    return res.status(400).json({ error: 'key is required' });
  }

  if (typeof chance !== 'number' || !Number.isFinite(chance)) {
    return res.status(400).json({ error: 'chance must be a number' });
  }

  enemiesMode2.setBonusChance(key, chance);

  console.log(`Roulette bonus "${key}" chance -> ${(chance * 100).toFixed(1)}%`);

  res.json({ bonuses: enemiesMode2.listBonuses() });
});

app.post('/roulette/bonuses/reset', (req, res) => {
  enemiesMode2.resetBonuses();

  console.log('Roulette spawn bonuses -> restored to defaults');

  res.json({ bonuses: enemiesMode2.listBonuses() });
});

app.get('/roulette/perks', (req, res) => {
  res.json({ perks: perks.listPerks() });
});

app.post('/roulette/perks/toggle', (req, res) => {
  const { key, enabled } = req.body || {};

  if (typeof key !== 'string' || !key) {
    return res.status(400).json({ error: 'key is required' });
  }

  perks.setPerkEnabled(key, Boolean(enabled));

  console.log(`Roulette perk "${key}" -> ${enabled ? 'enabled' : 'disabled'}`);

  res.json({ perks: perks.listPerks() });
});

app.post('/roulette/perks/chance', (req, res) => {
  const { key, chance } = req.body || {};

  if (typeof key !== 'string' || !key) {
    return res.status(400).json({ error: 'key is required' });
  }

  if (typeof chance !== 'number' || !Number.isFinite(chance)) {
    return res.status(400).json({ error: 'chance must be a number' });
  }

  perks.setPerkChance(key, chance);

  console.log(`Roulette perk "${key}" chance -> ${(chance * 100).toFixed(1)}%`);

  res.json({ perks: perks.listPerks() });
});

app.post('/roulette/perks/reset', (req, res) => {
  perks.resetPerks();

  console.log('Roulette positive effects -> restored to defaults');

  res.json({ perks: perks.listPerks() });
});

/*
 * Manual roll fired from the settings page (no Twitch event).
 *   { user, count }               -> loot roll
 *   { user, kind: "spawn", category: "mutants" | "enemies" }
 *   { user, kind: "perk" }
 */
app.post('/roulette/trigger', (req, res) => {
  const { user, count, kind, category } = req.body || {};

  const who = (typeof user === 'string' && user.trim()) || 'Streamer';

  let event;

  if (kind === 'spawn') {
    event = {
      kind: 'manual-spawn',
      user: who,
      category: category === 'enemies' ? 'enemies' : 'mutants',
      rolls: Math.min(3, Math.max(1, Number(req.body.rolls) || 1)),
    };
  } else if (kind === 'perk') {
    event = { kind: 'manual-perk', user: who };
  } else {
    event = {
      kind: 'manual',
      user: who,
      manualCount: Math.min(3, Math.max(1, Number(count) || 1)),
    };
  }

  const job = roulette.handleEvent(event);

  if (!job) {
    return res.status(400).json({ error: 'Could not roll' });
  }

  console.log(`Roulette: manual ${job.mode} for ${job.user} -> ${job.label}`);

  res.json({ job });
});

/*
 * Simulate a Twitch event — for testing without live subs/bits.
 *   { kind: "subscribe" }
 *   { kind: "resub", months: 6 }
 *   { kind: "gift",  total: 5 }
 *   { kind: "reward" }               (uses the first managed reward, or a stub)
 */
app.post('/roulette/test', (req, res) => {
  const {
    kind = 'subscribe',
    user = 'TestViewer',
    bits,
    total,
    months,
    tier,
    isGift = false,
  } = req.body || {};

  const event = {
    kind,
    user,
    userLogin: user.toLowerCase(),
    bits: Number(bits) || 0,
    total: Number(total) || 1,
    months: Number(months) || null,
    tier: tier || '1000',
    isGift: Boolean(isGift),
  };

  if (kind === 'manual-spawn') {
    event.category = req.body.category === 'enemies' ? 'enemies' : 'mutants';
    event.rolls = Math.min(3, Math.max(1, Number(req.body.rolls) || 1));
  }

  if (kind === 'reward') {
    const wantSpawn = req.body.spawn === true || Boolean(req.body.category);

    const hasRealRewards =
      roulette.rewardMap &&
      [...roulette.rewardMap.values()].some(
        (def) =>
          def.rewardId && (wantSpawn ? def.kind === 'spawn' : def.kind !== 'spawn'),
      );

    if (hasRealRewards) {
      const match = [...roulette.rewardMap.entries()].find(([, def]) =>
        wantSpawn ? def.kind === 'spawn' : def.kind !== 'spawn',
      );

      event.rewardId = req.body.rewardId || match[0];
    } else if (wantSpawn) {
      roulette.setRewardMap(
        new Map([
          [
            'test-spawn',
            {
              kind: 'spawn',
              category: req.body.category === 'enemies' ? 'enemies' : 'mutants',
              rolls: Math.min(3, Math.max(1, Number(req.body.rolls) || 1)),
            },
          ],
        ]),
      );

      event.rewardId = 'test-spawn';
    } else {
      // no real rewards synced (not authed) — use a throwaway stub
      roulette.setRewardMap(
        new Map([['test-reward', { count: Number(req.body.count) || 1 }]]),
      );

      event.rewardId = 'test-reward';
    }

    event.rewardTitle = wantSpawn ? 'Test Spawn' : 'Test Reward';
  }

  const job = roulette.handleEvent(event);

  if (!job) {
    return res.status(400).json({ error: 'Event did not produce a roll', event });
  }

  res.json({ job });
});

app.get('/twitch/status', async (req, res) => {
  try {
    const tokens = await twitchAuth.ensureValidToken();

    res.json({
      connected: Boolean(tokens),
      login: tokens ? tokens.login : null,
    });
  } catch (error) {
    console.error('Failed to check Twitch status:', error.message);

    res.json({ connected: false, login: null });
  }
});

app.post('/twitch/auth/start', async (req, res) => {
  try {
    const deviceData = await twitchAuth.requestDeviceCode();

    pendingDeviceFlow = { status: 'pending', error: null };

    res.json({
      userCode: deviceData.user_code,
      verificationUri: deviceData.verification_uri,
      expiresIn: deviceData.expires_in,
    });

    // Poll in the background; frontend checks progress via /twitch/auth/poll-status
    twitchAuth
      .pollForToken(deviceData.device_code, deviceData.interval, deviceData.expires_in)
      .then(() => {
        pendingDeviceFlow = { status: 'connected', error: null };

        startEventSub();
        syncOrLoadRewards();
      })
      .catch((error) => {
        console.error(error);

        pendingDeviceFlow = { status: 'error', error: error.message };
      });
  } catch (error) {
    console.error(error);

    res.status(500).json({ error: 'Failed to start Twitch authorization' });
  }
});

app.get('/twitch/auth/poll-status', (req, res) => {
  if (!pendingDeviceFlow) {
    return res.json({ status: 'idle' });
  }

  res.json(pendingDeviceFlow);
});

app.get('/twitch/eventsub/status', (req, res) => {
  res.json(eventSub.getState());
});

app.get('/twitch/rewards', async (req, res) => {
  try {
    res.json({ rewards: await rewards.listRewards(), syncing: rewardsSyncing });
  } catch (error) {
    res.json({ rewards: [], syncing: rewardsSyncing, error: error.message });
  }
});

/*
 * Turn the channel-point rewards on / off without disconnecting Twitch.
 * Off = viewers can't redeem while the roulette isn't running.
 */
app.post('/twitch/rewards/enabled', async (req, res) => {
  const enabled = Boolean((req.body || {}).enabled);

  try {
    if (enabled) {
      rewards.clearIndividualDisables();

      const map = await rewards.ensureRewards();

      roulette.setRewardMap(map);

      console.log('Channel-point rewards enabled');
    } else {
      roulette.setRewardMap(null);

      await rewards.disableRewards();
    }

    res.json({ rewards: await rewards.listRewards() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/*
 * Whether rewards should be auto-created/force-enabled on server startup
 * or a fresh Twitch connect. Off by default — see syncOrLoadRewards().
 */
app.get('/twitch/rewards/auto-activate', (req, res) => {
  res.json({ autoActivate: rewards.getAutoActivate() });
});

app.post('/twitch/rewards/auto-activate', async (req, res) => {
  const autoActivate = Boolean((req.body || {}).autoActivate);

  rewards.setAutoActivate(autoActivate);

  // Flipping it on should take effect right away, not just next restart.
  if (autoActivate) {
    await syncRewards();
  }

  res.json({ autoActivate, rewards: await rewards.listRewards() });
});

/*
 * Streamer-tuned cost / per-user limit / cooldown / on-off for one
 * reward. Saved to disk, then immediately pushed to the live Twitch
 * reward.
 *   { key, cost?, maxPerUserPerStream?, cooldownSeconds?, enabled? }
 * Omit a field to leave it as-is; pass null to clear a limit. This
 * per-reward `enabled` is independent of (and survives) the blanket
 * /twitch/rewards/enabled switch below.
 */
app.post('/twitch/rewards/config', async (req, res) => {
  const { key, cost, maxPerUserPerStream, cooldownSeconds, enabled } = req.body || {};

  if (typeof key !== 'string' || !key) {
    return res.status(400).json({ error: 'key is required' });
  }

  try {
    rewards.setRewardOverride(key, {
      cost,
      maxPerUserPerStream,
      cooldownSeconds,
      enabled,
    });

    // Sync only THIS reward on Twitch — never touch any other reward's
    // live state as a side effect of saving one (that was the bug).
    await rewards.syncOneReward(key);

    const map = await rewards.buildRewardMap();

    roulette.setRewardMap(map);

    console.log(`Twitch reward "${key}" reconfigured by streamer`);

    res.json({ rewards: await rewards.listRewards() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/twitch/disconnect', async (req, res) => {
  eventSub.stop();
  roulette.setRewardMap(null);

  await rewards.disableRewards();

  twitchAuth.clearTokens();

  res.json({ success: true });
});

/*
 * ---------------------------------------------------------
 * REACT / SEA ASSETS
 * ---------------------------------------------------------
 */

if (isSea()) {
  app.use((req, res, next) => {
    let requestPath = req.path;

    if (requestPath === '/') {
      requestPath = '/index.html';
    }

    const assetKey = `dist${requestPath}`;

    try {
      const asset = getAsset(assetKey);

      const ext = path.extname(requestPath).toLowerCase();

      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);

      res.send(Buffer.from(asset));
    } catch {
      // React SPA fallback
      try {
        const asset = getAsset('dist/index.html');

        res.setHeader('Content-Type', 'text/html');

        res.send(Buffer.from(asset));
      } catch {
        next();
      }
    }
  });
} else {
  // In dev, server.cjs sits in the project root next to dist/.
  // In the bundled build, build/server.cjs sits one level below dist/.
  const DIST_PATH = fs.existsSync(path.join(__dirname, 'dist'))
    ? path.join(__dirname, 'dist')
    : path.join(__dirname, '..', 'dist');

  app.use(express.static(DIST_PATH));

  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(DIST_PATH, 'index.html'));
  });
}

/*
 * ---------------------------------------------------------
 * START SERVER
 * ---------------------------------------------------------
 */

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;

  console.log(`${MOD_NAME} running on ${url}`);

  const gammaPath = getGammaPath();
  const anomalyPath = bridge.getAnomalyPath();

  if (gammaPath) {
    console.log(`GAMMA path: ${gammaPath}`);
  } else {
    console.warn('GAMMA path: NOT FOUND — set it manually from Settings > Mod install');
  }

  if (anomalyPath) {
    console.log(`Anomaly path: ${anomalyPath}`);
  } else {
    console.warn('Anomaly path: NOT FOUND — set it manually from Settings > Mod install');
  }

  // If the user authorized Twitch in a previous run, reconnect now.
  twitchAuth
    .ensureValidToken()
    .then((tokens) => {
      if (tokens) {
        startEventSub();
        syncOrLoadRewards();
      } else {
        rewardsSyncing = false;

        console.log('----------------------------------------');
        console.log('Twitch is NOT connected — the roulette will not react to');
        console.log('subs, gift subs, bits or channel points until you link');
        console.log('your account.');
        console.log(`Open ${url}/settings and click "Connect Twitch".`);
        console.log('----------------------------------------');
      }
    })
    .catch((error) => {
      rewardsSyncing = false;

      console.error('Twitch token check failed:', error.message);

      console.log(`Open ${url}/settings to (re)connect your Twitch account.`);
    });

  // Open on the settings page — that's where the streamer links Twitch
  // and checks status. The slot machine is a click away in the navbar.
  exec(`start "" "${url}/settings"`);
});
