// Public Client ID from https://dev.twitch.tv/console/apps
// Safe to keep in source — Public clients have no secret to protect.
const TWITCH_CLIENT_ID = 'ugo3wieunix6rep473tgwomp5cb5wv';

// Must match one of the "OAuth Redirect URLs" registered for the app.
// Not actually used by Device Code Flow itself, but Twitch requires
// the app to have at least one on file.
const TWITCH_REDIRECT_URI = 'http://localhost:7770/auth/callback';

// Scopes needed for the events we listen to.
const TWITCH_SCOPES = ['bits:read', 'channel:read:subscriptions'];

module.exports = {
  TWITCH_CLIENT_ID,
  TWITCH_REDIRECT_URI,
  TWITCH_SCOPES,
};
