const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { isSea, getAsset } = require('node:sea');
const { exec } = require('child_process');
const twitchAuth = require('./twitch-auth.cjs');
const { TwitchEventSub } = require('./twitch-eventsub.cjs');

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
 * GAMMA PATH
 * ---------------------------------------------------------
 */

function getCommandFile(gammaPath) {
  return path.join(
    gammaPath,
    'mods',
    'GAMMA Weapon and Armor Slot Machine by rip_perri',
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
 * Try to automatically find GAMMA.
 */
function findGamma() {
  // Windows drives: C:\, D:\, E:\, etc.
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

  console.log('GAMMA installation not found.');

  return null;
}

/*
 * Find GAMMA whenever needed.
 */
function getGammaPath() {
  return findGamma();
}

/*
 * ---------------------------------------------------------
 * GAMMA API
 * ---------------------------------------------------------
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

  const gammaPath = getGammaPath();

  if (!gammaPath) {
    return res.status(400).json({
      error: 'GAMMA installation not found',
    });
  }

  const commandFile = getCommandFile(gammaPath);

  try {
    const lines = [];

    // Weapons
    if (Array.isArray(weapons)) {
      for (const weapon of weapons) {
        if (!weapon.itemId) {
          continue;
        }

        const ammo = weapon.ammo || '';

        lines.push(`WEAPON|${weapon.itemId}|${ammo}`);
      }
    }

    // Outfits
    if (Array.isArray(outfits)) {
      for (const outfit of outfits) {
        if (!outfit.itemId) {
          continue;
        }

        lines.push(`OUTFIT|${outfit.itemId}`);
      }
    }

    // Helmets
    if (Array.isArray(helmets)) {
      for (const helmet of helmets) {
        if (!helmet.itemId) {
          continue;
        }

        lines.push(`HELMET|${helmet.itemId}`);
      }
    }

    if (lines.length === 0) {
      return res.status(400).json({
        error: 'Loadout is empty',
      });
    }

    const command = lines.join('\n');

    fs.writeFileSync(commandFile, command, 'utf8');

    console.log('Loadout sent to GAMMA:');
    console.log(command);
    console.log('----------------------------------------');

    res.json({
      success: true,
      loadout: {
        weapons: weapons || [],
        outfits: outfits || [],
        helmets: helmets || [],
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Failed to write loadout command',
    });
  }
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

eventSub.on('event', (event) => {
  console.log('----------------------------------------');
  console.log('Twitch event:', JSON.stringify(event, null, 2));
  console.log('----------------------------------------');
});

async function startEventSub() {
  try {
    await eventSub.start();
  } catch (error) {
    console.error('Failed to start Twitch EventSub:', error.message);
  }
}

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
