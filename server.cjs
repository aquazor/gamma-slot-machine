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
 * CONFIG
 * ---------------------------------------------------------
 */

const APP_DIR = isSea() ? path.dirname(process.execPath) : __dirname;

const CONFIG_FILE = path.join(APP_DIR, 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    console.error('Failed to read config:', error);
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

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

  const commandFile = getCommandFile(gammaPath);

  return fs.existsSync(commandFile);
}

/*
 * Try to automatically find GAMMA.
 */
function findGamma() {
  // Windows drives: C:\, D:\, E:\, etc.
  const drives = [];

  for (let i = 67; i <= 90; i++) {
    const drive = `${String.fromCharCode(i)}:\\`;

    if (fs.existsSync(drive)) {
      drives.push(drive);
    }
  }

  for (const drive of drives) {
    const gammaPath = path.join(drive, 'GAMMA');

    if (isValidGammaPath(gammaPath)) {
      console.log(`GAMMA found: ${gammaPath}`);

      return gammaPath;
    }
  }

  console.log('GAMMA installation not found.');

  return null;
}

function getGammaPath() {
  const config = loadConfig();

  // First use saved path
  if (isValidGammaPath(config.gammaPath)) {
    return config.gammaPath;
  }

  // Otherwise try automatic detection
  const detectedPath = findGamma();

  if (detectedPath) {
    saveConfig({
      ...config,
      gammaPath: detectedPath,
    });

    return detectedPath;
  }

  return null;
}

/*
 * ---------------------------------------------------------
 * GAMMA API
 * ---------------------------------------------------------
 */

/**
 * Get current GAMMA configuration
 */
app.get('/gamma', (req, res) => {
  const gammaPath = getGammaPath();

  res.json({
    configured: Boolean(gammaPath),
    gammaPath,
  });
});

/**
 * Set GAMMA path manually
 */
app.post('/gamma', (req, res) => {
  const { gammaPath } = req.body;

  if (!gammaPath) {
    return res.status(400).json({
      error: 'gammaPath is required',
    });
  }

  const normalizedPath = path.normalize(gammaPath);

  if (!isValidGammaPath(normalizedPath)) {
    return res.status(400).json({
      error: 'Invalid GAMMA path. Could not find Slot Machine bridge.',
    });
  }

  const config = loadConfig();

  saveConfig({
    ...config,
    gammaPath: normalizedPath,
  });

  console.log(`GAMMA path saved: ${normalizedPath}`);

  res.json({
    success: true,
    gammaPath: normalizedPath,
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
      error: 'GAMMA path is not configured',
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

  console.log(`GAMMA path: ${getGammaPath() || 'NOT FOUND'}`);

  exec(`start "" "${url}"`);
});
