const { EventEmitter } = require('events');

const twitchAuth = require('./twitch-auth.cjs');
const { TWITCH_CLIENT_ID } = require('./config.cjs');

/*
 * ---------------------------------------------------------
 * ENDPOINTS
 * ---------------------------------------------------------
 * Overridable via env vars so the Twitch CLI mock EventSub
 * server can be used for local testing:
 *
 *   twitch event websocket start-server
 *   TWITCH_EVENTSUB_WS_URL=ws://127.0.0.1:8080/ws \
 *   TWITCH_HELIX_URL=http://127.0.0.1:8080 node server.cjs
 */

const EVENTSUB_WS_URL =
  process.env.TWITCH_EVENTSUB_WS_URL || 'wss://eventsub.wss.twitch.tv/ws';

const HELIX_URL = process.env.TWITCH_HELIX_URL || 'https://api.twitch.tv/helix';

const SUBSCRIPTIONS_URL = `${HELIX_URL}/eventsub/subscriptions`;

/*
 * Topics we listen to. All three use a plain
 * { broadcaster_user_id } condition and version "1".
 *
 * NOTE on gift sub bombs: Twitch fires ONE
 * `channel.subscription.gift` for the gifter, plus a
 * `channel.subscribe` with is_gift=true for EACH recipient.
 * Consumers should treat is_gift subscribes carefully to
 * avoid rewarding the same gift bomb many times.
 */
const TOPICS = [
  { type: 'channel.cheer', version: '1' },
  { type: 'channel.subscribe', version: '1' },
  { type: 'channel.subscription.gift', version: '1' },
  { type: 'channel.subscription.message', version: '1' }, // resubs
];

const SEEN_MESSAGE_TTL_MS = 10 * 60 * 1000; // Twitch may redeliver within 10 min
const MAX_RECONNECT_DELAY_MS = 60 * 1000;

/*
 * ---------------------------------------------------------
 * CLIENT
 * ---------------------------------------------------------
 * Events emitted:
 *   'connected'    { sessionId }
 *   'subscribed'   [typesCreated]
 *   'reconnected'
 *   'disconnected' { code, reason }
 *   'revocation'   subscription
 *   'error'        Error
 *   'event'        normalized  (every notification)
 *   'cheer' | 'subscribe' | 'gift'  normalized  (per kind)
 */

class TwitchEventSub extends EventEmitter {
  constructor() {
    super();

    this.ws = null;
    this.reconnectWs = null;
    this.sessionId = null;
    this.broadcasterId = null;

    this.stopped = true;
    this.keepaliveSeconds = 10;
    this.keepaliveTimer = null;
    this.reconnectDelay = 1000;

    this.seenMessageIds = new Map();
  }

  /*
   * Public: open the connection. Safe to call again to force
   * a full reconnect.
   */
  async start() {
    const tokens = await twitchAuth.ensureValidToken();

    if (!tokens) {
      throw new Error('Twitch is not connected — authorize first.');
    }

    if (!tokens.broadcaster_id) {
      throw new Error('Stored Twitch tokens have no broadcaster_id.');
    }

    this.broadcasterId = tokens.broadcaster_id;
    this.stopped = false;

    this._teardownSocket(this.ws);
    this._connect(EVENTSUB_WS_URL, false);
  }

  /*
   * Public: close the connection and stop reconnecting.
   */
  stop() {
    this.stopped = true;

    this._clearKeepalive();
    this._teardownSocket(this.ws);
    this._teardownSocket(this.reconnectWs);

    this.ws = null;
    this.reconnectWs = null;
    this.sessionId = null;
  }

  /*
   * Public: snapshot for a status endpoint.
   */
  getState() {
    return {
      running: !this.stopped,
      connected: Boolean(this.ws && this.ws.readyState === WebSocket.OPEN),
      sessionId: this.sessionId,
      broadcasterId: this.broadcasterId,
    };
  }

  /*
   * -------------------------------------------------------
   * SOCKET LIFECYCLE
   * -------------------------------------------------------
   */

  _connect(url, viaReconnect) {
    const ws = new WebSocket(url);

    ws.addEventListener('message', (messageEvent) => {
      this._onMessage(ws, messageEvent);
    });

    ws.addEventListener('close', (closeEvent) => {
      this._onClose(ws, closeEvent);
    });

    ws.addEventListener('error', () => {
      // A follow-up 'close' handles reconnection; just surface it.
      this.emit('error', new Error('EventSub websocket error'));
    });

    if (viaReconnect) {
      this.reconnectWs = ws;
    } else {
      this.ws = ws;
    }
  }

  _onClose(ws, closeEvent) {
    if (ws === this.reconnectWs) {
      // The reconnect socket died before it could take over.
      this.reconnectWs = null;
      return;
    }

    if (ws !== this.ws) {
      // Stale socket we already replaced — ignore.
      return;
    }

    this._clearKeepalive();
    this.ws = null;

    if (this.stopped) {
      return;
    }

    this.emit('disconnected', {
      code: closeEvent.code,
      reason: String(closeEvent.reason || ''),
    });

    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.stopped) {
      return;
    }

    const delay = this.reconnectDelay;

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);

    setTimeout(() => {
      if (this.stopped) {
        return;
      }

      this.start().catch((error) => {
        this.emit('error', error);

        this._scheduleReconnect();
      });
    }, delay);
  }

  _teardownSocket(ws) {
    if (!ws) {
      return;
    }

    try {
      ws.close();
    } catch {
      // already closed
    }
  }

  /*
   * -------------------------------------------------------
   * MESSAGE HANDLING
   * -------------------------------------------------------
   */

  async _onMessage(ws, messageEvent) {
    let message;

    try {
      message = JSON.parse(messageEvent.data);
    } catch {
      return;
    }

    const metadata = message.metadata || {};
    const { message_id: messageId, message_type: messageType } = metadata;

    // De-duplicate redelivered messages.
    if (messageId) {
      if (this.seenMessageIds.has(messageId)) {
        return;
      }

      this.seenMessageIds.set(messageId, Date.now());
      this._pruneSeenMessages();
    }

    this._bumpKeepalive(ws);

    switch (messageType) {
      case 'session_welcome':
        await this._onWelcome(ws, message.payload.session);
        break;

      case 'session_keepalive':
        // Presence heartbeat only — keepalive timer already bumped.
        break;

      case 'session_reconnect':
        this._connect(message.payload.session.reconnect_url, true);
        break;

      case 'notification':
        this._onNotification(message);
        break;

      case 'revocation':
        this.emit('revocation', message.payload.subscription);
        break;

      default:
        break;
    }
  }

  async _onWelcome(ws, session) {
    this.keepaliveSeconds = session.keepalive_timeout_seconds || 10;
    this._bumpKeepalive(ws);

    if (ws === this.reconnectWs) {
      // Promote the reconnect socket; subscriptions carry over,
      // so we must NOT recreate them.
      const previous = this.ws;

      this.ws = ws;
      this.reconnectWs = null;
      this.sessionId = session.id;

      this._teardownSocket(previous);

      this.emit('reconnected');

      return;
    }

    this.ws = ws;
    this.sessionId = session.id;
    this.reconnectDelay = 1000;

    this.emit('connected', { sessionId: this.sessionId });

    await this._createSubscriptions();
  }

  async _createSubscriptions() {
    let tokens;

    try {
      tokens = await twitchAuth.ensureValidToken();
    } catch (error) {
      this.emit('error', error);

      return;
    }

    if (!tokens) {
      this.emit('error', new Error('Lost Twitch authorization before subscribing.'));

      return;
    }

    const created = [];

    for (const topic of TOPICS) {
      try {
        const res = await fetch(SUBSCRIPTIONS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            'Client-Id': TWITCH_CLIENT_ID,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: topic.type,
            version: topic.version,
            condition: { broadcaster_user_id: String(this.broadcasterId) },
            transport: { method: 'websocket', session_id: this.sessionId },
          }),
        });

        if (!res.ok) {
          const text = await res.text();

          this.emit(
            'error',
            new Error(`Failed to subscribe ${topic.type}: ${res.status} ${text}`),
          );

          continue;
        }

        created.push(topic.type);
      } catch (error) {
        this.emit('error', error);
      }
    }

    this.emit('subscribed', created);
  }

  /*
   * -------------------------------------------------------
   * NOTIFICATIONS → NORMALIZED EVENTS
   * -------------------------------------------------------
   */

  _onNotification(message) {
    const type = message.metadata.subscription_type;
    const event = message.payload.event || {};

    let normalized = null;

    if (type === 'channel.cheer') {
      normalized = {
        kind: 'cheer',
        user: event.is_anonymous ? null : event.user_name || event.user_login || null,
        userLogin: event.user_login || null,
        bits: event.bits,
        message: event.message || '',
        isAnonymous: Boolean(event.is_anonymous),
      };
    } else if (type === 'channel.subscribe') {
      normalized = {
        kind: 'subscribe',
        user: event.user_name || event.user_login || null,
        userLogin: event.user_login || null,
        tier: event.tier, // "1000" | "2000" | "3000"
        isGift: Boolean(event.is_gift),
      };
    } else if (type === 'channel.subscription.message') {
      normalized = {
        kind: 'resub',
        user: event.user_name || event.user_login || null,
        userLogin: event.user_login || null,
        tier: event.tier,
        months: event.cumulative_months || null,
        streakMonths: event.streak_months || null,
        durationMonths: event.duration_months || null,
        message: (event.message && event.message.text) || '',
      };
    } else if (type === 'channel.subscription.gift') {
      normalized = {
        kind: 'gift',
        user: event.is_anonymous ? null : event.user_name || event.user_login || null,
        userLogin: event.user_login || null,
        total: event.total, // subs gifted in this action
        tier: event.tier,
        cumulativeTotal: event.cumulative_total ?? null,
        isAnonymous: Boolean(event.is_anonymous),
      };
    }

    if (!normalized) {
      return;
    }

    normalized.type = type;
    normalized.raw = event;

    this.emit('event', normalized);
    this.emit(normalized.kind, normalized);
  }

  /*
   * -------------------------------------------------------
   * KEEPALIVE WATCHDOG
   * -------------------------------------------------------
   * Twitch guarantees a message every keepalive_timeout
   * seconds. If the window lapses (plus buffer), the
   * connection is silently dead — force a reconnect.
   */

  _bumpKeepalive(ws) {
    if (ws !== this.ws) {
      return;
    }

    this._clearKeepalive();

    const timeoutMs = (this.keepaliveSeconds + 10) * 1000;

    this.keepaliveTimer = setTimeout(() => {
      this.emit('error', new Error('EventSub keepalive timed out — reconnecting.'));

      this._teardownSocket(ws);
      // _onClose will schedule the reconnect.
    }, timeoutMs);
  }

  _clearKeepalive() {
    if (this.keepaliveTimer) {
      clearTimeout(this.keepaliveTimer);

      this.keepaliveTimer = null;
    }
  }

  _pruneSeenMessages() {
    const cutoff = Date.now() - SEEN_MESSAGE_TTL_MS;

    for (const [id, seenAt] of this.seenMessageIds) {
      if (seenAt < cutoff) {
        this.seenMessageIds.delete(id);
      }
    }
  }
}

module.exports = { TwitchEventSub, TOPICS };
