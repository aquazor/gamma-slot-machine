// Public Client ID from https://dev.twitch.tv/console/apps
// Safe to keep in source — Public clients have no secret to protect.
const TWITCH_CLIENT_ID = 'ugo3wieunix6rep473tgwomp5cb5wv';

// Must match one of the "OAuth Redirect URLs" registered for the app.
// Not actually used by Device Code Flow itself, but Twitch requires
// the app to have at least one on file.
const TWITCH_REDIRECT_URI = 'http://localhost:7770/auth/callback';

// Scopes needed for the events we listen to.
//   bits:read                  -> channel.cheer
//   channel:read:subscriptions -> channel.subscribe / .gift / .message
//   channel:manage:redemptions -> create channel-point rewards + read redemptions
const TWITCH_SCOPES = [
  'bits:read',
  'channel:read:subscriptions',
  'channel:manage:redemptions',
];

// Channel-point rewards the app creates & manages on the broadcaster's
// channel. Matched to existing rewards by `title` on startup.
//   count                — how many items the roll produces
//   maxPerUserPerStream  — Twitch caps redemptions per viewer per broadcast
//   cooldownSeconds      — Twitch enforces a global cooldown between redemptions
// Twitch enforces these limits itself (reward greys out, points not spent).
// Redemptions are NOT auto-fulfilled: they stay in the streamer's queue
// (should_redemptions_skip_request_queue: false) so points can be
// refunded manually from the Twitch Stream Manager.
//   kind     — 'loot' spins the item roulette, 'spawn' the mutant/enemy one
//   count    — (loot) how many items the roll produces
//   category — (spawn) 'mutants' | 'enemies'
//   rolls    — (spawn) how many groups to roll at once (default 1). Picks
//              are independent, so the same group can come up more than once.
//              Each group's creature count is auto-reduced when rolls > 1
//              (enemies.cjs countForRoll) so a "x3" reward spawns roughly
//              as many total creatures as three separate "x1" rolls, not 3x.
const CHANNEL_POINT_REWARDS = [
  {
    key: 'spawn-enemies',
    title: 'Spawn Enemies',
    cost: 2000,
    prompt: 'Drop a hostile squad near the streamer.',
    kind: 'spawn',
    category: 'enemies',
    maxPerUserPerStream: 2,
    cooldownSeconds: 60,
    rolls: 1,
  },
  {
    key: 'spawn-enemies-3',
    title: 'Spawn Enemies x3',
    cost: 6000,
    prompt: 'Drop three hostile squads near the streamer.',
    kind: 'spawn',
    category: 'enemies',
    maxPerUserPerStream: 2,
    cooldownSeconds: 60,
    rolls: 3,
  },
  {
    key: 'spawn-mutants',
    title: 'Spawn Mutants',
    cost: 2000,
    prompt: 'Drop a pack of mutants near the streamer.',
    kind: 'spawn',
    category: 'mutants',
    maxPerUserPerStream: 2,
    cooldownSeconds: 60,
    rolls: 1,
  },
  {
    key: 'spawn-mutants-3',
    title: 'Spawn Mutants x3',
    cost: 6000,
    prompt: 'Drop three packs of mutants near the streamer.',
    kind: 'spawn',
    category: 'mutants',
    maxPerUserPerStream: 2,
    cooldownSeconds: 60,
    rolls: 3,
  },
  {
    key: 'loot-roll-1',
    title: 'Loot Roll 1 item',
    cost: 2000,
    prompt: 'Spin the GAMMA loot roulette for one random item.',
    kind: 'loot',
    maxPerUserPerStream: 2,
    cooldownSeconds: 60,
    count: 1,
  },
  {
    key: 'loot-roll-3',
    title: 'Loot Roll 3 items',
    cost: 6000,
    prompt: 'Spin the GAMMA loot roulette for three random items.',
    kind: 'loot',
    maxPerUserPerStream: 2,
    cooldownSeconds: 60,
    count: 3,
  },
];

// Master switch for the whole bits-triggers-a-roll feature. false =
// cheering never rolls anything (roulette.cjs's cheer case short-
// circuits), and the "Bits rewards" section in /settings hides itself
// (GET /roulette/bits-rewards returns an empty list). Nothing below is
// deleted — flip back to true to bring it all back as-is.
const BITS_REWARDS_ENABLED = false;

// Bits (cheer) thresholds — not a Twitch Custom Reward (no reward id to
// enable/disable there), just how a plain `cheer<amount>` in chat maps to
// a roll. All tiers (loot AND spawn) share ONE ladder: whichever tier has
// the highest `bits` at or below what was cheered wins; below the lowest
// threshold, nothing rolls. Ordered enemies -> mutants -> loot, same as
// CHANNEL_POINT_REWARDS above.
//   bits     — minimum bits cheered to trigger this tier — the ONLY
//              streamer-tunable field here, same as `cost` on a channel-
//              point reward. `kind`/`count`/`category`/`rolls` define
//              what a tier DOES and are fixed, not editable from /settings.
//   kind     — 'loot' spins the item roulette, 'spawn' the mutant/enemy one
//   count    — (loot) how many items the roll produces
//   category — (spawn) 'mutants' | 'enemies'
//   rolls    — (spawn) how many groups to roll at once — see the matching
//              comment on CHANNEL_POINT_REWARDS above
// Test values — retune thresholds from /settings once real usage shows
// what feels right.
const BITS_REWARDS = [
  { key: 'bits-spawn-enemies', bits: 50, kind: 'spawn', category: 'enemies', rolls: 1 },
  {
    key: 'bits-spawn-enemies-3',
    bits: 200,
    kind: 'spawn',
    category: 'enemies',
    rolls: 3,
  },
  { key: 'bits-spawn-mutants', bits: 75, kind: 'spawn', category: 'mutants', rolls: 1 },
  {
    key: 'bits-spawn-mutants-3',
    bits: 300,
    kind: 'spawn',
    category: 'mutants',
    rolls: 3,
  },
  { key: 'bits-roll-1', bits: 50, kind: 'loot', count: 1 },
  { key: 'bits-roll-2', bits: 100, kind: 'loot', count: 2 },
  { key: 'bits-roll-3', bits: 150, kind: 'loot', count: 3 },
];

// Difficulty presets for the Twitch roulette — the streamer switches
// these live in /settings (no restart). Each preset lists the allowed
// `repair` grades per slot; the roll only picks items in those grades.
//   weapons  A (best) .. D (worst)
//   armor / helmets  F (field) .. H (heavy)  — exo (E) is never rolled
const PRESETS = {
  Basic: { weapon: ['A', 'B'], helmet: ['F', 'L'], armor: ['F', 'L'] },
  Advanced: { weapon: ['B', 'C'], helmet: ['L', 'M'], armor: ['L', 'M'] },
  Expert: { weapon: ['C', 'D'], helmet: ['M', 'H'], armor: ['M', 'H'] },
};

const DEFAULT_PRESET = 'Basic';

// Spawn roulette difficulty. The actual tier lists live in
// enemies.data.json (keyed Basic / Advanced / Expert); this is
// only the default selection. Switched live in /settings, not persisted.
const DEFAULT_SPAWN_TIER = 'Basic';

module.exports = {
  TWITCH_CLIENT_ID,
  TWITCH_REDIRECT_URI,
  TWITCH_SCOPES,
  CHANNEL_POINT_REWARDS,
  BITS_REWARDS,
  BITS_REWARDS_ENABLED,
  PRESETS,
  DEFAULT_PRESET,
  DEFAULT_SPAWN_TIER,
};
