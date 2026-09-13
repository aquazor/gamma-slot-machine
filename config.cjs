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
//   previousTitle        — a reward's title before its last rename. Lets
//                          ensureOneReward (twitch-rewards.cjs) find and
//                          rename the SAME live reward in place instead of
//                          creating a duplicate under the new title and
//                          orphaning the old one. Safe to leave in place
//                          permanently — once the live reward is renamed,
//                          `title` matches directly and this is never used.
//   count                — how many items the roll produces
//   maxPerUserPerStream  — Twitch caps redemptions per viewer per broadcast
//   cooldownSeconds      — Twitch enforces a global cooldown between redemptions
// Twitch enforces these limits itself (reward greys out, points not spent).
// Redemptions are NOT auto-fulfilled: they stay in the streamer's queue
// (should_redemptions_skip_request_queue: false) so points can be
// refunded manually from the Twitch Stream Manager.
//   kind     — 'loot' spins the item roulette, 'spawn' the mutant/enemy one
//   count    — (loot) how many items the roll produces. null = randomized
//              1-3 at redemption time (roulette.cjs).
//   category — (spawn) 'mutants' | 'enemies'
//   rolls    — (spawn) how many groups to roll at once. null = randomized
//              1-3 at redemption time, same as `count` above. Picks are
//              independent, so the same group can come up more than once;
//              each group's creature count is auto-reduced when rolls > 1
//              (enemies.cjs countForRoll) so rolling 3 spawns roughly as
//              many total creatures as three separate single rolls, not 3x.
const CHANNEL_POINT_REWARDS = [
  {
    key: 'spawn-squads',
    title: '[SPIN] Spawn Squads',
    previousTitle: '[SPIN] Spawn Enemies',
    cost: 3000,
    prompt: 'Drop 1-3 hostile squads near the streamer (random).',
    kind: 'spawn',
    category: 'enemies',
    maxPerUserPerStream: 2,
    cooldownSeconds: 60,
    rolls: null,
  },
  {
    key: 'spawn-mutants',
    title: '[SPIN] Spawn Mutants',
    cost: 3000,
    prompt: 'Drop 1-3 mutant packs near the streamer (random).',
    kind: 'spawn',
    category: 'mutants',
    maxPerUserPerStream: 2,
    cooldownSeconds: 60,
    rolls: null,
  },
  {
    key: 'loot-roll',
    title: '[SPIN] Loot Roll',
    previousTitle: '[SPIN] Loot Roll 1 item',
    cost: 3000,
    prompt: 'Spin the GAMMA loot roulette for 1-3 random items.',
    kind: 'loot',
    maxPerUserPerStream: 2,
    cooldownSeconds: 60,
    count: null,
  },
];

// Titles this app used to manage but has since consolidated away. Deleted
// outright (not just disabled) on the next full sync so the streamer's
// Twitch reward list doesn't accumulate abandoned entries when rewards
// get merged/renamed — see twitch-rewards.cjs's pruneObsoleteRewards().
const OBSOLETE_REWARD_TITLES = [
  '[SPIN] Spawn Enemies x3',
  '[SPIN] Spawn Mutants x3',
  '[SPIN] Loot Roll 3 items',
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

// Custom Power-ups (Twitch's bits-funded custom rewards) — added May 2026,
// with EventSub support (channel.custom_power_up_redemption.add) but NO
// create/update/delete API yet, only a read-only list. So unlike
// CHANNEL_POINT_REWARDS above, these are NOT auto-created: the streamer
// creates them by hand in the Twitch dashboard (Viewer Rewards > Custom
// Power-ups) and this app just matches them by `title` — same pattern as
// CHANNEL_POINT_REWARDS, and the titles below match the equivalent
// channel-point reward names 1:1. Each one always rolls a random 1-3,
// same as its channel-point counterpart; there's no cost here to keep in
// sync since there's no update API — set the Bits price on Twitch itself.
const CUSTOM_POWER_UPS_ENABLED = true;
const CUSTOM_POWER_UPS = [
  { title: '[SPIN] Spawn Squads', kind: 'spawn', category: 'enemies' },
  { title: '[SPIN] Spawn Mutants', kind: 'spawn', category: 'mutants' },
  { title: '[SPIN] Loot Roll', kind: 'loot' },
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
  OBSOLETE_REWARD_TITLES,
  BITS_REWARDS,
  BITS_REWARDS_ENABLED,
  CUSTOM_POWER_UPS,
  CUSTOM_POWER_UPS_ENABLED,
  PRESETS,
  DEFAULT_PRESET,
  DEFAULT_SPAWN_TIER,
};
