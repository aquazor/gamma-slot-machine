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
const CHANNEL_POINT_REWARDS = [
  {
    key: 'loot-roll-1',
    title: 'Loot Roll 1 item',
    cost: 100,
    prompt: 'Spin the GAMMA loot roulette for one random item.',
    count: 1,
  },
  {
    key: 'loot-roll-3',
    title: 'Loot Roll 3 items',
    cost: 300,
    prompt: 'Spin the GAMMA loot roulette for three random items.',
    count: 3,
  },
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

module.exports = {
  TWITCH_CLIENT_ID,
  TWITCH_REDIRECT_URI,
  TWITCH_SCOPES,
  CHANNEL_POINT_REWARDS,
  PRESETS,
  DEFAULT_PRESET,
};
