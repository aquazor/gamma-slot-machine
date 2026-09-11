const fs = require('fs');
const os = require('os');
const path = require('path');

const { BITS_REWARDS } = require('./config.cjs');

/*
 * ---------------------------------------------------------
 * BITS (CHEER) THRESHOLDS
 * ---------------------------------------------------------
 * Not Twitch Custom Rewards — a plain `cheer<amount>` in chat, mapped to
 * a roll (loot OR spawn) by threshold. One shared ladder across both
 * kinds: highest `bits` at or below the cheered amount wins. Streamer
 * can only retune `bits` (the threshold — same role as `cost` on a
 * channel-point reward) from /settings, same override-file pattern as
 * twitch-rewards.cjs's channel-point overrides. `kind` / `count` /
 * `category` / `rolls` are fixed by config.cjs: they define what a tier
 * DOES, not how much it costs, exactly like CHANNEL_POINT_REWARDS.
 */

const OVERRIDES_PATH = path.join(os.homedir(), '.gamma-slot-machine', 'bits-overrides.json');

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

function mergeOverride(def, overrides) {
  const o = overrides[def.key];

  if (!o || !Number.isFinite(o.bits)) {
    return def;
  }

  return { ...def, bits: o.bits };
}

/*
 * BITS_REWARDS with any saved override merged in, sorted highest
 * threshold first (so planForBits can just take the first match).
 */
function effectiveBitsRewards() {
  const overrides = loadOverrides();

  return BITS_REWARDS.map((def) => mergeOverride(def, overrides)).sort(
    (a, b) => b.bits - a.bits,
  );
}

/*
 * Snapshot for the settings UI — always in BITS_REWARDS config order.
 * Deliberately NOT sorted by the (editable) `bits` value: sorting by a
 * field the streamer can change would reorder/swap rows on save as
 * soon as an edit crossed another tier's threshold.
 */
function listBitsRewards() {
  const overrides = loadOverrides();

  return BITS_REWARDS.map((def) => mergeOverride(def, overrides));
}

/*
 * Save a streamer-set threshold for one bits tier. `bits` is the only
 * editable field — see the file header for why. Returns the merged
 * definition.
 */
function setBitsRewardOverride(key, patch) {
  const def = BITS_REWARDS.find((d) => d.key === key);

  if (!def) {
    throw new Error(`Unknown bits reward key: ${key}`);
  }

  const bits = Math.floor(Number(patch.bits));

  if (!Number.isFinite(bits) || bits < 1) {
    throw new Error('Bits threshold must be a positive integer');
  }

  const overrides = loadOverrides();

  overrides[key] = { bits };
  saveOverrides(overrides);

  return effectiveBitsRewards().find((d) => d.key === key);
}

/*
 * Plan a roll for a cheered amount — highest threshold met wins, across
 * both loot and spawn tiers. Returns the matching tier (kind/count or
 * kind/category/rolls) or null if the cheer didn't reach the lowest one.
 */
function planForBits(bits) {
  return effectiveBitsRewards().find((t) => bits >= t.bits) || null;
}

module.exports = {
  effectiveBitsRewards,
  listBitsRewards,
  setBitsRewardOverride,
  planForBits,
};
