import { useCallback, useEffect, useRef, useState } from 'react';
import './Settings.css';

import Navbar from './Navbar';
import BitsRewards from './settings/BitsRewards';
import ChannelPointRewards from './settings/ChannelPointRewards';
import EnemyFactions from './settings/EnemyFactions';
import IntegrationsSection from './settings/IntegrationsSection';
import RouletteControls from './settings/RouletteControls';
import {
  API,
  type DeviceFlow,
  type EventSubStatus,
  type RouletteStatus,
  type TwitchStatus,
} from './settings/types';

export default function Settings() {
  const [twitch, setTwitch] = useState<TwitchStatus>({ connected: false, login: null });
  const [eventSub, setEventSub] = useState<EventSubStatus | null>(null);
  const [roulette, setRoulette] = useState<RouletteStatus | null>(null);

  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [authState, setAuthState] = useState<string>('idle');
  const [busy, setBusy] = useState<boolean>(false);
  const [ready, setReady] = useState<boolean>(false);
  const [reachable, setReachable] = useState<boolean>(true);

  const pollTimer = useRef<number | null>(null);

  // Guards against this component's own concurrent requests (the 4s
  // connection poll overlapping a just-issued core reload after connect/
  // disconnect). Channel points, bits, and factions now fetch and guard
  // themselves independently — this counter only covers twitch/eventSub/
  // roulette, the three pieces of state still owned here.
  const seq = useRef(0);
  const bumpSeq = useCallback(() => ++seq.current, []);
  const isStaleSeq = useCallback((s: number) => s !== seq.current, []);

  // One-time load of the state that's actually shared across sections
  // (Twitch connection, EventSub status, roulette preset/tier/queue).
  // Rewards, bits tiers, and enemy factions load themselves — they only
  // ever change in response to an action taken in their own section, so
  // there's nothing for this page to poll on their behalf.
  const loadCore = useCallback(async () => {
    const s = bumpSeq();

    try {
      const [t, e, r] = await Promise.all([
        fetch(`${API}/twitch/status`).then((res) => res.json()),
        fetch(`${API}/twitch/eventsub/status`).then((res) => res.json()),
        fetch(`${API}/roulette/status`).then((res) => res.json()),
      ]);

      if (isStaleSeq(s)) {
        return;
      }

      setTwitch(t);
      setEventSub(e);
      setRoulette(r);
      setReachable(true);
    } catch {
      if (!isStaleSeq(s)) {
        setReachable(false);
      }
    } finally {
      if (!isStaleSeq(s)) {
        setReady(true);
      }
    }
  }, [bumpSeq, isStaleSeq]);

  // Worth polling: Twitch's own connection can drop or recover in the
  // background (token refresh, EventSub reconnect), and roulette.queued /
  // roulette.overlayPresent change on the server as the overlay drains its
  // queue or OBS connects/disconnects — none of that is triggered by a
  // click in this tab. Rewards/bits/factions genuinely only change from an
  // action in their own section, so they're excluded from this poll.
  const pollStatus = useCallback(async () => {
    const s = bumpSeq();

    try {
      const [t, e, r] = await Promise.all([
        fetch(`${API}/twitch/status`).then((res) => res.json()),
        fetch(`${API}/twitch/eventsub/status`).then((res) => res.json()),
        fetch(`${API}/roulette/status`).then((res) => res.json()),
      ]);

      if (isStaleSeq(s)) {
        return;
      }

      setTwitch(t);
      setEventSub(e);
      setRoulette(r);
      setReachable(true);
    } catch {
      if (!isStaleSeq(s)) {
        setReachable(false);
      }
    }
  }, [bumpSeq, isStaleSeq]);

  useEffect(() => {
    loadCore();

    const interval = window.setInterval(pollStatus, 4000);

    return () => {
      window.clearInterval(interval);

      if (pollTimer.current) {
        window.clearTimeout(pollTimer.current);
      }
    };
  }, [loadCore, pollStatus]);

  const pollAuth = useCallback(() => {
    pollTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`${API}/twitch/auth/poll-status`).then((r) => r.json());

        setAuthState(res.status);

        if (res.status === 'connected') {
          setFlow(null);
          loadCore();

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
  }, [loadCore]);

  const connect = useCallback(async (): Promise<void> => {
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
  }, [pollAuth]);

  const disconnect = useCallback(async (): Promise<void> => {
    if (!window.confirm('Disconnect Twitch? The roulette will stop reacting to events.')) {
      return;
    }

    await fetch(`${API}/twitch/disconnect`, { method: 'POST' });

    setFlow(null);
    setAuthState('idle');
    loadCore();
  }, [loadCore]);

  const [triggerBusy, setTriggerBusy] = useState<boolean>(false);

  // Only `roulette.queued` can change from a manual trigger — no need to
  // reload the connection status alongside it.
  const refreshRouletteStatus = useCallback(async (): Promise<void> => {
    const s = bumpSeq();

    try {
      const r = await fetch(`${API}/roulette/status`).then((res) => res.json());

      if (!isStaleSeq(s)) {
        setRoulette(r);
      }
    } catch {
      // leave the last known state in place
    }
  }, [bumpSeq, isStaleSeq]);

  const manualRoll = useCallback(
    async (count: number): Promise<void> => {
      setTriggerBusy(true);

      try {
        await fetch(`${API}/roulette/trigger`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: 'Streamer', count }),
        });
      } finally {
        setTriggerBusy(false);
        refreshRouletteStatus();
      }
    },
    [refreshRouletteStatus],
  );

  const manualSpawn = useCallback(
    async (category: 'mutants' | 'enemies', rolls: number): Promise<void> => {
      setTriggerBusy(true);

      try {
        await fetch(`${API}/roulette/trigger`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'spawn', category, rolls, user: 'Streamer' }),
        });
      } finally {
        setTriggerBusy(false);
        refreshRouletteStatus();
      }
    },
    [refreshRouletteStatus],
  );

  const selectPreset = useCallback(
    async (name: string): Promise<void> => {
      setRoulette((prev) => {
        if (!prev || prev.preset === name) {
          return prev;
        }

        return { ...prev, preset: name };
      });

      const s = bumpSeq();

      const updated = await fetch(`${API}/roulette/preset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: name }),
      }).then((res) => res.json());

      if (!isStaleSeq(s) && !updated.error) {
        setRoulette(updated);
      }
    },
    [bumpSeq, isStaleSeq],
  );

  const selectSpawnTier = useCallback(
    async (name: string): Promise<void> => {
      setRoulette((prev) => {
        if (!prev || prev.spawnTier === name) {
          return prev;
        }

        return { ...prev, spawnTier: name };
      });

      const s = bumpSeq();

      const updated = await fetch(`${API}/roulette/spawn-tier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: name }),
      }).then((res) => res.json());

      if (!isStaleSeq(s) && !updated.error) {
        setRoulette(updated);
      }
    },
    [bumpSeq, isStaleSeq],
  );

  const [copied, setCopied] = useState<boolean>(false);

  const copyOverlayUrl = useCallback(async (): Promise<void> => {
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
  }, []);

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
              <IntegrationsSection
                twitch={twitch}
                eventSub={eventSub}
                overlayPresent={Boolean(roulette?.overlayPresent)}
                busy={busy}
                flow={flow}
                authState={authState}
                copied={copied}
                connect={connect}
                disconnect={disconnect}
                copyOverlayUrl={copyOverlayUrl}
              />

              <ChannelPointRewards twitchConnected={twitch.connected} />

              <BitsRewards />

              <RouletteControls
                roulette={roulette}
                triggerBusy={triggerBusy}
                selectPreset={selectPreset}
                selectSpawnTier={selectSpawnTier}
                manualRoll={manualRoll}
                manualSpawn={manualSpawn}
              />

              <EnemyFactions />
            </>
          )}
        </div>
      </div>
    </>
  );
}
