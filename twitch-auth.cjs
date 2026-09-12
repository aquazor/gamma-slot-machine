const fs = require('fs');
const os = require('os');
const path = require('path');

const { TWITCH_CLIENT_ID, TWITCH_SCOPES } = require('./config.cjs');

const TOKEN_DIR = path.join(os.homedir(), '.gamma-slot-machine');
const TOKEN_PATH = path.join(TOKEN_DIR, 'twitch-tokens.json');

const DEVICE_CODE_URL = 'https://id.twitch.tv/oauth2/device';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const USERS_URL = 'https://api.twitch.tv/helix/users';

/*
 * ---------------------------------------------------------
 * TOKEN STORAGE
 * ---------------------------------------------------------
 */

function loadTokens() {
  try {
    const raw = fs.readFileSync(TOKEN_PATH, 'utf8');

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
}

function clearTokens() {
  try {
    fs.unlinkSync(TOKEN_PATH);
  } catch {
    // nothing to clear
  }
}

/*
 * ---------------------------------------------------------
 * DEVICE CODE FLOW — START
 * ---------------------------------------------------------
 */

async function requestDeviceCode() {
  const body = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    scopes: TWITCH_SCOPES.join(' '),
  });

  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();

    throw new Error(`Failed to request device code: ${res.status} ${text}`);
  }

  const data = await res.json();

  // data: { device_code, expires_in, interval, user_code, verification_uri }
  return data;
}

/*
 * ---------------------------------------------------------
 * DEVICE CODE FLOW — POLL FOR TOKEN
 * ---------------------------------------------------------
 * Call this after showing the user_code / verification_uri to the user.
 * Resolves once they approve on twitch.tv/activate, or rejects on
 * expiry / denial.
 */

async function pollForToken(deviceCode, intervalSeconds, expiresInSeconds, onTick) {
  const deadline = Date.now() + expiresInSeconds * 1000;
  let interval = intervalSeconds * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);

    if (onTick) {
      onTick();
    }

    const body = new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const data = await res.json();

    if (res.ok) {
      // data: { access_token, refresh_token, expires_in, scope, token_type }
      const tokens = await attachUserInfo(data);

      saveTokens(tokens);

      return tokens;
    }

    // Twitch returns specific error codes while waiting/denied/expired.
    if (data.message === 'authorization_pending') {
      continue;
    }

    if (data.message === 'slow_down') {
      interval += 5000;
      continue;
    }

    // access_denied, expired_token, or anything else — stop polling.
    throw new Error(`Device code flow failed: ${data.message || res.status}`);
  }

  throw new Error('Device code expired before user approved.');
}

/*
 * ---------------------------------------------------------
 * REFRESH
 * ---------------------------------------------------------
 * DCF refresh tokens are single-use: every refresh returns a NEW
 * refresh_token that must be saved, replacing the old one.
 */

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();

    throw new Error(`Failed to refresh token: ${res.status} ${text}`);
  }

  const data = await res.json();
  const tokens = await attachUserInfo(data);

  saveTokens(tokens);

  return tokens;
}

/*
 * ---------------------------------------------------------
 * ENSURE VALID TOKEN
 * ---------------------------------------------------------
 * Call before any Twitch API/EventSub use. Refreshes if expired
 * or close to expiring. Returns null if the user was never
 * authorized (caller should trigger the device code flow).
 *
 * On boot, server.cjs / TwitchEventSub.start() / twitch-rewards.cjs
 * each call this independently within the same tick. DCF refresh
 * tokens are single-use — without the single-flight guard below,
 * whichever of those calls found the token stale would ALL fire
 * their own /oauth2/token refresh concurrently with the same
 * refresh_token, racing each other. One "wins", but the others end
 * up using an access_token that's already stale by the time it's
 * used, which surfaces as attachUserInfo's Helix call getting a 401
 * even though the refresh itself appeared to succeed. Sharing one
 * in-flight refresh promise across all concurrent callers fixes it.
 */

let refreshInFlight = null;

async function ensureValidToken() {
  const tokens = loadTokens();

  if (!tokens) {
    return null;
  }

  const bufferMs = 5 * 60 * 1000; // refresh 5 min before real expiry

  if (Date.now() < tokens.expires_at - bufferMs) {
    return tokens;
  }

  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken(tokens.refresh_token).finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

/*
 * ---------------------------------------------------------
 * HELPERS
 * ---------------------------------------------------------
 */

async function attachUserInfo(rawTokenResponse) {
  const res = await fetch(USERS_URL, {
    headers: {
      Authorization: `Bearer ${rawTokenResponse.access_token}`,
      'Client-Id': TWITCH_CLIENT_ID,
    },
  });

  if (!res.ok) {
    const text = await res.text();

    throw new Error(`Failed to fetch user info: ${res.status} ${text}`);
  }

  const data = await res.json();
  const user = data.data && data.data[0];

  return {
    access_token: rawTokenResponse.access_token,
    refresh_token: rawTokenResponse.refresh_token,
    expires_at: Date.now() + rawTokenResponse.expires_in * 1000,
    scope: rawTokenResponse.scope,
    broadcaster_id: user ? user.id : null,
    login: user ? user.login : null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  loadTokens,
  saveTokens,
  clearTokens,
  requestDeviceCode,
  pollForToken,
  refreshAccessToken,
  ensureValidToken,
};
