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

// The mutable fields we drive from CHANNEL_POINT_REWARDS.
function desiredFields(def) {
  return {
    is_enabled: true,
    cost: def.cost,
    is_max_per_user_per_stream_enabled: def.maxPerUserPerStream != null,
    max_per_user_per_stream: def.maxPerUserPerStream ?? 0,
    is_global_cooldown_enabled: def.cooldownSeconds != null,
    global_cooldown_seconds: def.cooldownSeconds ?? 0,
  };
}

// Does the live reward differ from what the config wants?
function needsSync(reward, def) {
  if (!reward.is_enabled || reward.cost !== def.cost) {
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

async function ensureRewards() {
  const broadcasterId = await getBroadcasterId();

  const listed = await helix(
    'GET',
    `${REWARDS_URL}?broadcaster_id=${broadcasterId}&only_manageable_rewards=true`,
  );

  const byTitle = new Map((listed.data || []).map((reward) => [reward.title, reward]));

  const managed = new Map();

  for (const def of CHANNEL_POINT_REWARDS) {
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

    managed.set(reward.id, { ...def, rewardId: reward.id, cost: reward.cost });
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

  const ours = new Set(CHANNEL_POINT_REWARDS.map((def) => def.title));

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
 * Snapshot for the settings UI.
 */
async function listRewards() {
  const broadcasterId = await getBroadcasterId();

  const listed = await helix(
    'GET',
    `${REWARDS_URL}?broadcaster_id=${broadcasterId}&only_manageable_rewards=true`,
  );

  const ours = new Map(CHANNEL_POINT_REWARDS.map((def) => [def.title, def]));

  return (listed.data || [])
    .filter((reward) => ours.has(reward.title))
    .map((reward) => {
      const perUser = reward.max_per_user_per_stream_setting || {};
      const cooldown = reward.global_cooldown_setting || {};

      return {
        id: reward.id,
        title: reward.title,
        cost: reward.cost,
        enabled: reward.is_enabled,
        count: ours.get(reward.title).count,
        maxPerUserPerStream: perUser.is_enabled ? perUser.max_per_user_per_stream : null,
        cooldownSeconds: cooldown.is_enabled ? cooldown.global_cooldown_seconds : null,
      };
    });
}

module.exports = { ensureRewards, disableRewards, listRewards };
