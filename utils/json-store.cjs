const fs = require('fs');
const os = require('os');
const path = require('path');

/*
 * One small JSON file under ~/.gamma-slot-machine/ — the app's user-data
 * folder (tokens, overrides, settings). Reads never throw (a missing or
 * corrupt file just yields a fresh copy of `fallback`); writes create the
 * folder on demand.
 */

const DATA_DIR = path.join(os.homedir(), '.gamma-slot-machine');

function createJsonStore(filename, fallback = {}) {
  const filePath = path.join(DATA_DIR, filename);

  function read() {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return structuredClone(fallback);
    }
  }

  function write(value) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  }

  return { path: filePath, read, write };
}

module.exports = { DATA_DIR, createJsonStore };
