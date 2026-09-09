import { useCallback, useEffect, useRef, useState } from 'react';
import './Settings.css';

import Navbar from './Navbar';

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
  overlayPresent: boolean;
  preset: string;
  presets: string[];
  queued: number;
}

interface Reward {
  id: string;
  title: string;
  cost: number;
  enabled: boolean;
  count: number;
  maxPerUserPerStream: number | null;
  cooldownSeconds: number | null;
}

interface DeviceFlow {
  userCode: string;
  verificationUri: string;
}

export default function Settings() {
  const [twitch, setTwitch] = useState<TwitchStatus>({ connected: false, login: null });
  const [eventSub, setEventSub] = useState<EventSubStatus | null>(null);
  const [roulette, setRoulette] = useState<RouletteStatus | null>(null);
  const [rewardList, setRewardList] = useState<Reward[]>([]);

  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [authState, setAuthState] = useState<string>('idle');
  const [busy, setBusy] = useState<boolean>(false);
  const [ready, setReady] = useState<boolean>(false);
  const [reachable, setReachable] = useState<boolean>(true);

  const pollTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, e, r, rw] = await Promise.all([
        fetch(`${API}/twitch/status`).then((res) => res.json()),
        fetch(`${API}/twitch/eventsub/status`).then((res) => res.json()),
        fetch(`${API}/roulette/status`).then((res) => res.json()),
        fetch(`${API}/twitch/rewards`).then((res) => res.json()),
      ]);

      setTwitch(t);
      setEventSub(e);
      setRoulette(r);
      setRewardList(Array.isArray(rw.rewards) ? rw.rewards : []);
      setReachable(true);
    } catch {
      setReachable(false);
    } finally {
      setReady(true);
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
    if (
      !window.confirm('Disconnect Twitch? The roulette will stop reacting to events.')
    ) {
      return;
    }

    await fetch(`${API}/twitch/disconnect`, { method: 'POST' });

    setFlow(null);
    setAuthState('idle');
    refresh();
  };

  const [triggerUser, setTriggerUser] = useState<string>('');
  const [triggerBusy, setTriggerBusy] = useState<boolean>(false);

  const manualRoll = async (count: number): Promise<void> => {
    setTriggerBusy(true);

    try {
      await fetch(`${API}/roulette/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: triggerUser.trim() || 'Streamer', count }),
      });
    } finally {
      setTriggerBusy(false);
      refresh();
    }
  };

  const selectPreset = async (name: string): Promise<void> => {
    if (!roulette || roulette.preset === name) {
      return;
    }

    setRoulette({ ...roulette, preset: name });

    await fetch(`${API}/roulette/preset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: name }),
    });

    refresh();
  };

  const [rewardsBusy, setRewardsBusy] = useState<boolean>(false);

  const setRewardsEnabled = async (enabled: boolean): Promise<void> => {
    setRewardsBusy(true);

    try {
      const res = await fetch(`${API}/twitch/rewards/enabled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }).then((r) => r.json());

      if (Array.isArray(res.rewards)) {
        setRewardList(res.rewards);
      }
    } finally {
      setRewardsBusy(false);
      refresh();
    }
  };

  const [copied, setCopied] = useState<boolean>(false);

  const copyOverlayUrl = async (): Promise<void> => {
    const url = `${API}/overlay`;

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const area = document.createElement('textarea');
      area.value = url;
      area.style.position = 'fixed';
      area.style.opacity = '0';

      document.body.appendChild(area);
      area.select();

      try {
        document.execCommand('copy');
      } catch {
        // clipboard unavailable
      }

      area.remove();
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <Navbar />

      <div className="set-root">
        <div className="set-card">
          <h1 className="set-title">🎰 Loot Roulette — Settings</h1>

          {!ready ? (
            <div className="set-loading">
              <span className="set-spinner" />
              Loading…
            </div>
          ) : !reachable ? (
            <div className="set-loading">
              Can’t reach the server on <code>{API}</code>. Is it running?
            </div>
          ) : (
            <>
              {/* ---- INTEGRATIONS ---- */}

              <section className="set-section">
                <h2 className="set-heading">Integrations</h2>

                <div className="set-integration">
                  <h3 className="set-subheading">Twitch</h3>

                  {twitch.connected ? (
                    <>
                      <div className="set-row">
                        <span className="set-badge set-badge--ok">Connected</span>
                        <span className="set-muted">as {twitch.login}</span>
                        <button className="set-btn" onClick={disconnect}>
                          Disconnect
                        </button>
                      </div>

                      <div className="set-row">
                        <span
                          className={`set-badge ${
                            eventSub?.connected ? 'set-badge--ok' : 'set-badge--off'
                          }`}
                        >
                          {eventSub?.connected ? 'Listening' : 'Not listening'}
                        </span>
                        <span className="set-muted">
                          subs · resubs · gift subs · bits · channel points
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="set-row">
                      <span className="set-badge set-badge--off">Not connected</span>
                      <button
                        className="set-btn set-btn--primary"
                        onClick={connect}
                        disabled={busy}
                      >
                        {busy ? 'Starting…' : 'Connect Twitch'}
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
                </div>

                <div className="set-integration">
                  <h3 className="set-subheading">OBS overlay</h3>

                  <div className="set-row">
                    <span
                      className={`set-badge ${
                        roulette?.overlayPresent ? 'set-badge--ok' : 'set-badge--off'
                      }`}
                    >
                      {roulette?.overlayPresent ? 'Connected' : 'Not open'}
                    </span>
                  </div>

                  <div className="set-obs">
                    <span className="set-muted">Browser Source URL</span>
                    <code>{API}/overlay</code>
                    <button className="set-btn set-obs-copy" onClick={copyOverlayUrl}>
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </section>

              {/* ---- CHANNEL POINTS ---- */}

              <section className="set-section">
                <h2 className="set-heading">Channel point rewards</h2>

                {rewardList.length > 0 ? (
                  <>
                  <div className="set-rewards">
                    {rewardList.map((reward) => (
                      <div className="set-reward" key={reward.id}>
                        <span
                          className={`set-badge ${
                            reward.enabled ? 'set-badge--ok' : 'set-badge--off'
                          }`}
                        >
                          {reward.enabled ? 'Live' : 'Disabled'}
                        </span>
                        <span className="set-reward-title">{reward.title}</span>
                        <span className="set-muted">
                          {reward.cost.toLocaleString()} pts → {reward.count} item
                          {reward.count > 1 ? 's' : ''}
                          {reward.maxPerUserPerStream != null &&
                            ` · ${reward.maxPerUserPerStream}/user`}
                          {reward.cooldownSeconds != null &&
                            (reward.cooldownSeconds < 60
                              ? ` · ${reward.cooldownSeconds}s cooldown`
                              : ` · ${Math.round(reward.cooldownSeconds / 60)} min cooldown`)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {rewardList.some((reward) => reward.enabled) ? (
                    <button
                      className="set-btn"
                      onClick={() => setRewardsEnabled(false)}
                      disabled={rewardsBusy}
                    >
                      {rewardsBusy ? 'Working…' : 'Disable rewards'}
                    </button>
                  ) : (
                    <button
                      className="set-btn set-btn--primary"
                      onClick={() => setRewardsEnabled(true)}
                      disabled={rewardsBusy}
                    >
                      {rewardsBusy ? 'Working…' : 'Enable rewards'}
                    </button>
                  )}
                  </>
                ) : (
                  <p className="set-muted">
                    {twitch.connected
                      ? 'Rewards will be created automatically once the connection has the channel-points permission — reconnect Twitch if you just updated.'
                      : 'Connect Twitch to create the reward.'}
                  </p>
                )}

                <p className="set-muted set-obs">
                  Redemptions stay in your Twitch queue — fulfill or refund them
                  manually in the Stream Manager.
                </p>
              </section>

              {/* ---- ROULETTE ---- */}

              <section className="set-section">
                <h2 className="set-heading">Roulette</h2>

                {roulette && roulette.presets?.length > 0 && (
                  <div className="set-presets">
                    <span className="set-muted">Loot tier</span>
                    <div className="set-preset-group">
                      {roulette.presets.map((name) => (
                        <button
                          key={name}
                          className={`set-preset ${
                            roulette.preset === name ? 'is-active' : ''
                          }`}
                          onClick={() => selectPreset(name)}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="set-trigger">
                  <span className="set-muted">Manual roll</span>
                  <input
                    className="set-input"
                    placeholder="viewer name (optional)"
                    value={triggerUser}
                    onChange={(event) => setTriggerUser(event.target.value)}
                  />
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      className="set-btn"
                      onClick={() => manualRoll(n)}
                      disabled={triggerBusy}
                    >
                      {n} item{n > 1 ? 's' : ''}
                    </button>
                  ))}
                </div>

                {typeof roulette?.queued === 'number' && roulette.queued > 0 && (
                  <p className="set-muted">{roulette.queued} roll(s) queued</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
