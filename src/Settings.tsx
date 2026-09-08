import { useCallback, useEffect, useRef, useState } from 'react';
import './Settings.css';

const API = 'http://localhost:7770';

interface TwitchStatus {
  connected: boolean;
  login: string | null;
}

interface EventSubStatus {
  running: boolean;
  connected: boolean;
  sessionId: string | null;
}

interface RouletteStatus {
  autoGive: boolean;
  overlayPresent: boolean;
  queued: number;
}

interface DeviceFlow {
  userCode: string;
  verificationUri: string;
}

export default function Settings() {
  const [twitch, setTwitch] = useState<TwitchStatus>({ connected: false, login: null });
  const [eventSub, setEventSub] = useState<EventSubStatus | null>(null);
  const [roulette, setRoulette] = useState<RouletteStatus | null>(null);

  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [authState, setAuthState] = useState<string>('idle');
  const [busy, setBusy] = useState<boolean>(false);

  const pollTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, e, r] = await Promise.all([
        fetch(`${API}/twitch/status`).then((res) => res.json()),
        fetch(`${API}/twitch/eventsub/status`).then((res) => res.json()),
        fetch(`${API}/roulette/status`).then((res) => res.json()),
      ]);

      setTwitch(t);
      setEventSub(e);
      setRoulette(r);
    } catch {
      // server not up yet
    }
  }, []);

  useEffect(() => {
    refresh();

    const interval = window.setInterval(refresh, 4000);

    return () => {
      window.clearInterval(interval);

      if (pollTimer.current) {
        window.clearTimeout(pollTimer.current);
      }
    };
  }, [refresh]);

  const pollAuth = useCallback(() => {
    pollTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`${API}/twitch/auth/poll-status`).then((r) => r.json());

        setAuthState(res.status);

        if (res.status === 'connected') {
          setFlow(null);
          refresh();

          return;
        }

        if (res.status === 'error') {
          setFlow(null);

          return;
        }
      } catch {
        // ignore
      }

      pollAuth();
    }, 2500);
  }, [refresh]);

  const connect = async (): Promise<void> => {
    setBusy(true);

    try {
      const res = await fetch(`${API}/twitch/auth/start`, { method: 'POST' }).then((r) =>
        r.json(),
      );

      setFlow({ userCode: res.userCode, verificationUri: res.verificationUri });
      setAuthState('pending');

      window.open(res.verificationUri, '_blank', 'noopener');

      pollAuth();
    } catch {
      setAuthState('error');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    if (!window.confirm('Disconnect Twitch? The roulette will stop reacting to events.')) {
      return;
    }

    await fetch(`${API}/twitch/disconnect`, { method: 'POST' });

    setFlow(null);
    setAuthState('idle');
    refresh();
  };

  const toggleAutoGive = async (): Promise<void> => {
    if (!roulette) {
      return;
    }

    const next = !roulette.autoGive;

    setRoulette({ ...roulette, autoGive: next });

    await fetch(`${API}/roulette/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoGive: next }),
    });

    refresh();
  };

  return (
    <div className="set-root">
      <div className="set-card">
        <h1 className="set-title">🎰 Loot Roulette — Settings</h1>

        <a className="set-back" href="/">
          ← Back to slot machine
        </a>

        {/* ---- TWITCH ---- */}

        <section className="set-section">
          <h2 className="set-heading">Twitch connection</h2>

          {twitch.connected ? (
            <div className="set-row">
              <span className="set-badge set-badge--ok">Connected</span>
              <span className="set-muted">as {twitch.login}</span>
              <button className="set-btn" onClick={disconnect}>
                Disconnect
              </button>
            </div>
          ) : (
            <div className="set-row">
              <span className="set-badge set-badge--off">Not connected</span>
              <button className="set-btn set-btn--primary" onClick={connect} disabled={busy}>
                Connect Twitch
              </button>
            </div>
          )}

          {flow && (
            <div className="set-flow">
              <p>
                Open <strong>{flow.verificationUri}</strong> and enter this code:
              </p>
              <div className="set-code">{flow.userCode}</div>
              <p className="set-muted">
                {authState === 'pending'
                  ? 'Waiting for you to approve on Twitch…'
                  : authState}
              </p>
            </div>
          )}
        </section>

        {/* ---- EVENTSUB ---- */}

        <section className="set-section">
          <h2 className="set-heading">Event listener</h2>
          <div className="set-row">
            <span
              className={`set-badge ${
                eventSub?.connected ? 'set-badge--ok' : 'set-badge--off'
              }`}
            >
              {eventSub?.connected ? 'Listening' : 'Offline'}
            </span>
            <span className="set-muted">
              subs · resubs · gift subs · bits (cheer 100 / 300 / 500)
            </span>
          </div>
        </section>

        {/* ---- ROULETTE ---- */}

        <section className="set-section">
          <h2 className="set-heading">Roulette</h2>

          <label className="set-toggle">
            <input
              type="checkbox"
              checked={roulette?.autoGive ?? false}
              onChange={toggleAutoGive}
            />
            <span>
              Auto-give rolled items in game
              <span className="set-muted"> — off = roll shows on overlay only</span>
            </span>
          </label>

          <div className="set-row">
            <span
              className={`set-badge ${
                roulette?.overlayPresent ? 'set-badge--ok' : 'set-badge--off'
              }`}
            >
              Overlay {roulette?.overlayPresent ? 'connected' : 'not open'}
            </span>
            {typeof roulette?.queued === 'number' && roulette.queued > 0 && (
              <span className="set-muted">{roulette.queued} queued</span>
            )}
          </div>

          <p className="set-muted set-obs">
            OBS Browser Source URL: <code>{API}/overlay</code>
          </p>
        </section>
      </div>
    </div>
  );
}
