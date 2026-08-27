const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { isSea, getAsset } = require('node:sea');
const { exec } = require('child_process');

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
const PORT = 3000;

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
    'GAMMA Slot Machine',
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
      console.log(`GAMMA found: ${gammaPath}`);

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
 * GIVE WEAPON
 * ---------------------------------------------------------
 */

app.post('/give', (req, res) => {
  const { itemId } = req.body;

  console.log('GIVE WEAPON:', itemId);

  if (!itemId) {
    return res.status(400).json({
      error: 'itemId is required',
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
    fs.writeFileSync(commandFile, itemId, 'utf8');

    console.log(`Command sent to GAMMA: ${itemId}`);

    res.json({
      success: true,
      itemId,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Failed to write command file',
    });
  }
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
  const DIST_PATH = path.join(__dirname, '..', 'dist');

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

  console.log(`GAMMA Weapon Roulette running on ${url}`);

  const gammaPath = getGammaPath();

  console.log(`GAMMA path: ${gammaPath || 'NOT FOUND'}`);

  exec(`start "" "${url}"`);
});
