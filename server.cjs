const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { isSea, getAsset } = require('node:sea');
const { exec } = require('child_process');
const twitchAuth = require('./twitch-auth.cjs');
const { TwitchEventSub } = require('./twitch-eventsub.cjs');
const { Roulette } = require('./roulette.cjs');
const bridge = require('./gamma-bridge.cjs');

const { getGammaPath, getCommandFile } = bridge;

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

eventSub.on('connected', ({ sessionId }) => {
  console.log(`Twitch EventSub connected (session ${sessionId})`);
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
  console.log(`Roulette: rolling ${job.id} (${job.results.map((r) => r.slot).join(', ')})`);

  broadcastOverlay('roll', job);
});

roulette.on('delivered', (record) => {
  const items = record.results.map((r) => `${r.slot}:${r.itemId}`).join(', ');

  console.log(
    `Roulette: ${record.id} ${record.given ? `gave [${items}]` : `not given${record.giveError ? ` (${record.giveError})` : ''}`} (${record.reason})`,
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

app.post('/roulette/config', (req, res) => {
  if (typeof req.body?.autoGive === 'boolean') {
    roulette.setAutoGive(req.body.autoGive);
  }

  res.json(roulette.getState());
});

/*
 * Simulate a Twitch event — for testing without live subs/bits.
 *   { kind: "cheer",  bits: 300 }
 *   { kind: "subscribe" }
 *   { kind: "resub", months: 6 }
 *   { kind: "gift",  total: 5 }
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
    console.error(error);

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

app.post('/twitch/disconnect', (req, res) => {
  eventSub.stop();
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

  console.log(`GAMMA Weapon and Armor Slot Machine by rip_perri running on ${url}`);

  const gammaPath = getGammaPath();

  console.log(`GAMMA path: ${gammaPath || 'NOT FOUND'}`);

  // If the user authorized Twitch in a previous run, reconnect now.
  twitchAuth
    .ensureValidToken()
    .then((tokens) => {
      if (tokens) {
        startEventSub();
      }
    })
    .catch((error) => {
      console.error('Twitch token check failed:', error.message);
    });

  exec(`start "" "${url}"`);
});
