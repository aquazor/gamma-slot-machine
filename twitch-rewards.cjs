const fs = require('fs');
const os = require('os');
const path = require('path');

const twitchAuth = require('./twitch-auth.cjs');
const { TWITCH_CLIENT_ID, CHANNEL_POINT_REWARDS } = require('./config.cjs');

/*
 * ---------------------------------------------------------
 * CHANNEL-POINT REWARDS
 * ---------------------------------------------------------
 * The app creates & manages its own custom rewards. Only the
 * client id that created a reward can manage it and reliably
 * receive its redemption events, so we always create them
 * ourselves rather than asking the streamer to.
 *
 * Rewards are matched to what already exists on the channel by
 * `title` (titles are unique per channel), so restarts / rebuilds
 * reuse the same reward instead of piling up duplicates.
 */

const HELIX_URL = process.env.TWITCH_HELIX_URL || 'https://api.twitch.tv/helix';
const REWARDS_URL = `${HELIX_URL}/channel_points/custom_rewards`;

/*
 * ---------------------------------------------------------
 * STREAMER OVERRIDES
 * ---------------------------------------------------------
 * The streamer can tune cost / per-user limit / cooldown per reward
 * from /settings. Only those three fields are ever overridable — title
 * (and kind/category/count/rolls, which drive the roll logic) stay
 * exactly as defined in CHANNEL_POINT_REWARDS, so the title-based
 * matching above never drifts out from under a saved override, and a
 * reward the roulette knows how to roll never silently changes shape.
 *
 * Stored next to twitch-tokens.json — user data, not source.
 */

const OVERRIDES_PATH = path.join(os.homedir(), '.gamma-slot-machine', 'reward-overrides.json');

function loadOverrides() {
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveOverrides(overrides) {
  const dir = path.dirname(OVERRIDES_PATH);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2), 'utf8');
}

/*
 * CHANNEL_POINT_REWARDS with any saved override merged in.
 */
function effectiveRewards() {
  const overrides = loadOverrides();

  return CHANNEL_POINT_REWARDS.map((def) => {
    const o = overrides[def.key];

    if (!o) {
      return def;
    }

    return {
      ...def,
      cost: Number.isFinite(o.cost) ? o.cost : def.cost,
      maxPerUserPerStream:
        o.maxPerUserPerStream === null || Number.isFinite(o.maxPerUserPerStream)
          ? o.maxPerUserPerStream
          : def.maxPerUserPerStream,
      cooldownSeconds:
        o.cooldownSeconds === null || Number.isFinite(o.cooldownSeconds)
          ? o.cooldownSeconds
          : def.cooldownSeconds,
      // individually disabled by the streamer — independent of the
      // blanket "Disable rewards" switch, and survives it: a later
      // blanket "Enable rewards" re-syncs everything else but leaves
      // this one off (see desiredFields / needsSync below).
      enabled: typeof o.enabled === 'boolean' ? o.enabled : def.enabled !== false,
    };
  });
}

/*
 * Save a streamer-set override for one reward. `patch` fields left
 * `undefined` are untouched; pass `null` explicitly to clear a limit
 * (no per-user cap / no cooldown). Returns the merged definition.
 */
function setRewardOverride(key, patch) {
  const def = CHANNEL_POINT_REWARDS.find((d) => d.key === key);

  if (!def) {
    throw new Error(`Unknown reward key: ${key}`);
  }

  const overrides = loadOverrides();
  const next = { ...(overrides[key] || {}) };

  if (patch.cost !== undefined) {
    const cost = Math.floor(Number(patch.cost));

    if (!Number.isFinite(cost) || cost < 1) {
      throw new Error('Cost must be a positive integer');
    }

    next.cost = cost;
  }

  if (patch.maxPerUserPerStream !== undefined) {
    if (patch.maxPerUserPerStream === null) {
      next.maxPerUserPerStream = null;
    } else {
      const n = Math.floor(Number(patch.maxPerUserPerStream));

      if (!Number.isFinite(n) || n < 1) {
        throw new Error('Max per user per stream must be a positive integer, or empty for no limit');
      }

      next.maxPerUserPerStream = n;
    }
  }

  if (patch.cooldownSeconds !== undefined) {
    if (patch.cooldownSeconds === null) {
      next.cooldownSeconds = null;
    } else {
      const n = Math.floor(Number(patch.cooldownSeconds));

      if (!Number.isFinite(n) || n < 0) {
        throw new Error('Cooldown must be a non-negative number of seconds, or empty for no cooldown');
      }

      next.cooldownSeconds = n;
    }
  }

  if (patch.enabled !== undefined) {
    next.enabled = Boolean(patch.enabled);
  }

  overrides[key] = next;
  saveOverrides(overrides);

  return effectiveRewards().find((d) => d.key === key);
}

/*
 * Clear every individually-saved "disabled" override. Used by the
 * blanket "Enable rewards" switch: without this, a reward the streamer
 * had disabled one-by-one would stay off forever, making the blanket
 * switch look broken (it'd re-enable everything else but never that
 * one, so the button kept flip-flopping between Enable/Disable).
 */
function clearIndividualDisables() {
  const overrides = loadOverrides();
  let changed = false;

  for (const key of Object.keys(overrides)) {
    if (overrides[key].enabled === false) {
      delete overrides[key].enabled;
      changed = true;
    }
  }

  if (changed) {
    saveOverrides(overrides);
  }
}

async function helix(method, url, body) {
  const tokens = await twitchAuth.ensureValidToken();

  if (!tokens) {
    throw new Error('Twitch is not connected.');
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Client-Id': TWITCH_CLIENT_ID,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();

    throw new Error(`Twitch ${method} ${url} -> ${res.status} ${text}`);
  }

  if (res.status === 204) {
    return null;
  }

  return res.json();
}

async function getBroadcasterId() {
  const tokens = await twitchAuth.ensureValidToken();

  if (!tokens || !tokens.broadcaster_id) {
    throw new Error('No broadcaster id in stored Twitch tokens.');
  }

  return tokens.broadcaster_id;
}

/*
 * Create any missing rewards, and sync cost / limits / enabled state
 * on existing ones. Returns Map<reward_id, definition>.
 */

// The mutable fields we drive from CHANNEL_POINT_REWARDS (+ overrides).
function desiredFields(def) {
  return {
    is_enabled: def.enabled !== false,
    cost: def.cost,
    is_max_per_user_per_stream_enabled: def.maxPerUserPerStream != null,
    max_per_user_per_stream: def.maxPerUserPerStream ?? 0,
    is_global_cooldown_enabled: def.cooldownSeconds != null,
    global_cooldown_seconds: def.cooldownSeconds ?? 0,
  };
}

// Does the live reward differ from what the config wants?
function needsSync(reward, def) {
  if (reward.is_enabled !== (def.enabled !== false) || reward.cost !== def.cost) {
    return true;
  }

  const perUser = reward.max_per_user_per_stream_setting || {};
  const wantsPerUser = def.maxPerUserPerStream != null;

  if (Boolean(perUser.is_enabled) !== wantsPerUser) {
    return true;
  }

  if (wantsPerUser && perUser.max_per_user_per_stream !== def.maxPerUserPerStream) {
    return true;
  }

  const cooldown = reward.global_cooldown_setting || {};
  const wantsCooldown = def.cooldownSeconds != null;

  if (Boolean(cooldown.is_enabled) !== wantsCooldown) {
    return true;
  }

  if (wantsCooldown && cooldown.global_cooldown_seconds !== def.cooldownSeconds) {
    return true;
  }

  return false;
}

/*
 * Create the reward if Twitch doesn't have it yet, or PATCH it if its
 * live cost/limits/enabled state has drifted from `def`. Touches ONLY
 * this one reward — callers control how many defs they run it over.
 */
async function ensureOneReward(broadcasterId, byTitle, def) {
  let reward = byTitle.get(def.title);

  if (!reward) {
    const created = await helix(
      'POST',
      `${REWARDS_URL}?broadcaster_id=${broadcasterId}`,
      {
        title: def.title,
        prompt: def.prompt || '',
        is_user_input_required: false,
        should_redemptions_skip_request_queue: false,
        ...desiredFields(def),
      },
    );

    reward = created.data[0];

    console.log(`Twitch reward created: "${reward.title}" (${reward.cost} pts)`);
  } else if (needsSync(reward, def)) {
    const updated = await helix(
      'PATCH',
      `${REWARDS_URL}?broadcaster_id=${broadcasterId}&id=${reward.id}`,
      desiredFields(def),
    );

    reward = updated.data[0];

    console.log(`Twitch reward synced: "${reward.title}" (${reward.cost} pts)`);
  }

  return reward;
}

async function ensureRewards() {
  const broadcasterId = await getBroadcasterId();

  const listed = await helix(
    'GET',
    `${REWARDS_URL}?broadcaster_id=${broadcasterId}&only_manageable_rewards=true`,
  );

  const byTitle = new Map((listed.data || []).map((reward) => [reward.title, reward]));

  const managed = new Map();

  for (const def of effectiveRewards()) {
    const reward = await ensureOneReward(broadcasterId, byTitle, def);

    managed.set(reward.id, { ...def, rewardId: reward.id, cost: reward.cost });
  }

  return managed;
}

/*
 * Sync just ONE reward (by our key) to its current effective def —
 * used after the streamer edits a single reward's cost/limits/enabled
 * state, so that save can never touch any other reward on Twitch.
 */
async function syncOneReward(key) {
  const def = effectiveRewards().find((d) => d.key === key);

  if (!def) {
    throw new Error(`Unknown reward key: ${key}`);
  }

  const broadcasterId = await getBroadcasterId();

  const listed = await helix(
    'GET',
    `${REWARDS_URL}?broadcaster_id=${broadcasterId}&only_manageable_rewards=true`,
  );

  const byTitle = new Map((listed.data || []).map((reward) => [reward.title, reward]));

  return ensureOneReward(broadcasterId, byTitle, def);
}

/*
 * Read-only: rebuild the reward-id -> definition map the roulette uses
 * to route redemption events, WITHOUT creating or patching anything on
 * Twitch. Safe to call after syncOneReward so the map picks up the
 * change without re-touching every other reward.
 */
async function buildRewardMap() {
  const broadcasterId = await getBroadcasterId();

  const listed = await helix(
    'GET',
    `${REWARDS_URL}?broadcaster_id=${broadcasterId}&only_manageable_rewards=true`,
  );

  const byTitle = new Map((listed.data || []).map((reward) => [reward.title, reward]));

  const managed = new Map();

  for (const def of effectiveRewards()) {
    const reward = byTitle.get(def.title);

    if (reward) {
      managed.set(reward.id, { ...def, rewardId: reward.id, cost: reward.cost });
    }
  }

  return managed;
}

/*
 * Disable (not delete) our rewards — used on disconnect. Keeps
 * redemption history and makes re-enabling instant.
 */
async function disableRewards() {
  let broadcasterId;

  try {
    broadcasterId = await getBroadcasterId();
  } catch {
    return; // already logged out
  }

  let listed;

  try {
    listed = await helix(
      'GET',
      `${REWARDS_URL}?broadcaster_id=${broadcasterId}&only_manageable_rewards=true`,
    );
  } catch {
    return;
  }

  const ours = new Set(effectiveRewards().map((def) => def.title));

  for (const reward of listed.data || []) {
    if (ours.has(reward.title) && reward.is_enabled) {
      try {
        await helix(
          'PATCH',
          `${REWARDS_URL}?broadcaster_id=${broadcasterId}&id=${reward.id}`,
          { is_enabled: false },
        );

        console.log(`Twitch reward disabled: "${reward.title}"`);
      } catch (error) {
        console.error(`Failed to disable reward "${reward.title}":`, error.message);
      }
    }
  }
}

/*
 * Snapshot for the settings UI — always in CHANNEL_POINT_REWARDS order
 * (Twitch's own list order is arbitrary, not something we control).
 */
async function listRewards() {
  const broadcasterId = await getBroadcasterId();

  const listed = await helix(
    'GET',
    `${REWARDS_URL}?broadcaster_id=${broadcasterId}&only_manageable_rewards=true`,
  );

  const byTitle = new Map((listed.data || []).map((reward) => [reward.title, reward]));

  const rows = [];

  for (const def of effectiveRewards()) {
    const reward = byTitle.get(def.title);

    if (!reward) {
      continue;
    }

    const perUser = reward.max_per_user_per_stream_setting || {};
    const cooldown = reward.global_cooldown_setting || {};

    rows.push({
      id: reward.id,
      key: def.key,
      title: reward.title,
      cost: reward.cost,
      enabled: reward.is_enabled,
      kind: def.kind || 'loot',
      category: def.category || null,
      count: def.count || null,
      rolls: def.rolls || null,
      maxPerUserPerStream: perUser.is_enabled ? perUser.max_per_user_per_stream : null,
      cooldownSeconds: cooldown.is_enabled ? cooldown.global_cooldown_seconds : null,
    });
  }

  return rows;
}

module.exports = {
  ensureRewards,
  syncOneReward,
  buildRewardMap,
  disableRewards,
  listRewards,
  setRewardOverride,
  clearIndividualDisables,
};
