const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { isSea, getAsset } = require('node:sea');
const { exec } = require('child_process');
const twitchAuth = require('./twitch-auth.cjs');
const { TwitchEventSub } = require('./twitch-eventsub.cjs');
const { Roulette } = require('./roulette.cjs');
const rewards = require('./twitch-rewards.cjs');
const bridge = require('./gamma-bridge.cjs');
const enemies = require('./enemies.cjs');
const bitsRewards = require('./bits-rewards.cjs');
const { BITS_REWARDS_ENABLED } = require('./config.cjs');

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
 * Create / sync the channel-point rewards and hand the id -> definition
 * map to the roulette so redemptions can trigger rolls.
 */
async function syncRewards() {
  try {
    const map = await rewards.ensureRewards();

    roulette.setRewardMap(map);

    console.log(`Channel-point rewards ready: ${map.size}`);
  } catch (error) {
    console.error('Failed to sync channel-point rewards:', error.message);
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
      : record.results.map((r) => `${r.slot}:${r.itemId}`).join(', ');

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

/*
 * Which armed factions ('enemies' category) can currently be rolled —
 * a blanket on/off per faction, the same across every tier.
 */
app.get('/roulette/enemies', (req, res) => {
  res.json({ factions: enemies.listFactions() });
});

app.post('/roulette/enemies/toggle', (req, res) => {
  const { group, enabled } = req.body || {};

  if (typeof group !== 'string' || !group) {
    return res.status(400).json({ error: 'group is required' });
  }

  enemies.setFactionEnabled(group, Boolean(enabled));

  console.log(`Roulette faction "${group}" -> ${enabled ? 'enabled' : 'disabled'}`);

  res.json({ factions: enemies.listFactions() });
});

/*
 * Manual roll fired from the settings page (no Twitch event).
 *   { user, count }               -> loot roll
 *   { user, kind: "spawn", category: "mutants" | "enemies" }
 */
app.post('/roulette/trigger', (req, res) => {
  const { user, count, kind, category } = req.body || {};

  const who = (typeof user === 'string' && user.trim()) || 'Streamer';

  const event =
    kind === 'spawn'
      ? {
          kind: 'manual-spawn',
          user: who,
          category: category === 'enemies' ? 'enemies' : 'mutants',
          rolls: Math.min(3, Math.max(1, Number(req.body.rolls) || 1)),
        }
      : {
          kind: 'manual',
          user: who,
          manualCount: Math.min(3, Math.max(1, Number(count) || 1)),
        };

  const job = roulette.handleEvent(event);

  if (!job) {
    return res.status(400).json({ error: 'Could not roll' });
  }

  console.log(`Roulette: manual ${job.mode} for ${job.user} -> ${job.label}`);

  res.json({ job });
});

/*
 * Simulate a Twitch event — for testing without live subs/bits.
 *   { kind: "cheer",  bits: 300 }
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
        syncRewards();
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
    res.json({ rewards: await rewards.listRewards() });
  } catch (error) {
    res.json({ rewards: [], error: error.message });
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

/*
 * Bits (cheer) thresholds — not Twitch Custom Rewards, just how a plain
 * `cheer<amount>` in chat maps to a loot roll. No Twitch API call needed
 * to change these, unlike channel-point rewards.
 */
app.get('/roulette/bits-rewards', (req, res) => {
  res.json({ rewards: BITS_REWARDS_ENABLED ? bitsRewards.listBitsRewards() : [] });
});

app.post('/roulette/bits-rewards/config', (req, res) => {
  if (!BITS_REWARDS_ENABLED) {
    return res.status(400).json({ error: 'Bits rewards are currently disabled' });
  }

  const { key, bits } = req.body || {};

  if (typeof key !== 'string' || !key) {
    return res.status(400).json({ error: 'key is required' });
  }

  try {
    bitsRewards.setBitsRewardOverride(key, { bits });

    console.log(`Bits reward "${key}" reconfigured by streamer`);

    res.json({ rewards: bitsRewards.listBitsRewards() });
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

  console.log(`GAMMA path: ${gammaPath || 'NOT FOUND'}`);

  // If the user authorized Twitch in a previous run, reconnect now.
  twitchAuth
    .ensureValidToken()
    .then((tokens) => {
      if (tokens) {
        startEventSub();
        syncRewards();
      } else {
        console.log('----------------------------------------');
        console.log('Twitch is NOT connected — the roulette will not react to');
        console.log('subs, gift subs, bits or channel points until you link');
        console.log('your account.');
        console.log(`Open ${url}/settings and click "Connect Twitch".`);
        console.log('----------------------------------------');
      }
    })
    .catch((error) => {
      console.error('Twitch token check failed:', error.message);

      console.log(`Open ${url}/settings to (re)connect your Twitch account.`);
    });

  // Open on the settings page — that's where the streamer links Twitch
  // and checks status. The slot machine is a click away in the navbar.
  exec(`start "" "${url}/settings"`);
});
