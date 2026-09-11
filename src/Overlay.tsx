import { useEffect, useMemo, useRef, useState } from 'react';
import './Overlay.css';

import {
  pistols,
  shotguns,
  smgs,
  rifles,
  snipers,
  helmetsField,
  helmetsLight,
  helmetsMedium,
  helmetsHeavyExo,
  outfitsField,
  outfitsLight,
  outfitsMedium,
  outfitsHeavy,
  outfitsExo,
} from './constants';

/* ========================================
   CONFIG
======================================== */

const API = 'http://localhost:7770';

const ITEM_HEIGHT = 80; // must match .reel-item height in Overlay.css
const VISIBLE_ROWS = 3; // .reel-window is 3 * ITEM_HEIGHT tall
const SPIN_MS = 6000; // one reel's spin duration — matches spin.mp3 length
const GAP_MS = 350; // delay after a reel lands before the next starts
const HOLD_MS = 3500; // linger on the final result before fading out
const FADE_MS = 550;
const LEAD_MS = 400; // beat before the first reel starts

// Fixed scroll distance so every reel spins at the SAME visual speed
// regardless of how big its pool is (weapon pool ~206, helmet ~19).
const SPIN_DISTANCE_PX = 12000;
const SPIN_JITTER_ROWS = 6; // small random over/undershoot for variety

const SPIN_VOLUME = 0.35;
const EFFECT_COUNT = 46; // /gifs/effects/effect-0..45.gif
const WINNING_EFFECTS_COUNT = 12;
const EFFECTS_MS = 5000;

/* ========================================
   TYPES
======================================== */

type Slot = 'weapon' | 'helmet' | 'armor';

interface Item {
  id: string;
  name: string;
  repair?: string;
}

interface RollResult {
  slot: Slot;
  itemId: string;
  name: string;
  ammo?: string;
}

interface Job {
  id: string;
  user: string;
  label: string;
  kind: string;
  mode?: 'loot' | 'spawn';
  category?: string;
  spawnPool?: string[];
  preset?: string;
  grades?: Partial<Record<Slot, string[]>>;
  results: RollResult[];
}

interface WinningEffect {
  id: number;
  left: number;
  top: number;
  rotation: number;
  delay: number;
}

/* ========================================
   POOLS  (same source as the server's items.data.json)
======================================== */

const POOLS: Record<Slot, Item[]> = {
  weapon: [...pistols, ...shotguns, ...smgs, ...rifles, ...snipers],
  helmet: [...helmetsField, ...helmetsLight, ...helmetsMedium, ...helmetsHeavyExo],
  armor: [...outfitsField, ...outfitsLight, ...outfitsMedium, ...outfitsHeavy, ...outfitsExo],
};

const ICON_FOLDER: Record<Slot, string> = {
  weapon: 'wpn-icons',
  helmet: 'helmet-icons',
  armor: 'outfit-icons',
};

const SLOT_LABEL: Record<Slot, string> = {
  weapon: 'Weapon',
  helmet: 'Helmet',
  armor: 'Armor',
};

/* ========================================
   HELPERS
======================================== */

function shuffle<T>(array: T[]): T[] {
  const copy = [...array];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function hideBrokenImage(event: React.SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.style.visibility = 'hidden';
}

function playSpinSound(): void {
  try {
    const audio = new Audio('/sounds/spin.mp3');
    audio.volume = SPIN_VOLUME;

    void audio.play().catch(() => {
      // autoplay blocked outside OBS until a user gesture
    });
  } catch {
    // no audio available
  }
}

/* ========================================
   REEL
======================================== */

interface ReelProps {
  result: RollResult;
  grades?: string[];
  spin: boolean;
  landed: boolean;
}

function Reel({ result, grades, spin, landed }: ReelProps) {
  const pool = POOLS[result.slot];
  const folder = ICON_FOLDER[result.slot];

  // Scrolling filler stays on-theme with the current preset's grades.
  const fillPool = useMemo(() => {
    if (!grades || grades.length === 0) {
      return pool;
    }

    const filtered = pool.filter((item) =>
      grades.includes((item.repair ?? '').toUpperCase()),
    );

    return filtered.length > 0 ? filtered : pool;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const real = pool.find((item) => item.id === result.itemId);
  const targetName = real?.name ?? result.name;
  const repair = (real?.repair ?? '').toLowerCase();

  const [effects, setEffects] = useState<WinningEffect[]>([]);
  const [showEffects, setShowEffects] = useState<boolean>(false);

  // Sparkles + emote burst when this reel lands.
  useEffect(() => {
    if (!landed) {
      return;
    }

    const burst = shuffle(Array.from({ length: EFFECT_COUNT }, (_, index) => index))
      .slice(0, WINNING_EFFECTS_COUNT)
      .map((id, index) => ({
        id,
        left: 10 + Math.random() * 80,
        top: 10 + Math.random() * 80,
        rotation: -25 + Math.random() * 50,
        delay: index * 0.12,
      }));

    setEffects(burst);
    setShowEffects(true);

    const timer = window.setTimeout(() => {
      setShowEffects(false);
      setEffects([]);
    }, EFFECTS_MS);

    return () => window.clearTimeout(timer);
  }, [landed]);

  // Strip: random rows for a FIXED scroll distance (so every reel spins
  // at the same visual speed), the winning row at that distance, then a
  // few more rows so the window is never half-empty after it lands.
  const { strip, targetIndex } = useMemo(() => {
    const jitter = Math.round((Math.random() * 2 - 1) * SPIN_JITTER_ROWS);
    const target = Math.round(SPIN_DISTANCE_PX / ITEM_HEIGHT) + jitter;

    const winner = real ?? { id: result.itemId, name: targetName };

    const need = target + VISIBLE_ROWS + 2;

    const randomItem = (): Item =>
      fillPool[Math.floor(Math.random() * fillPool.length)];

    // Fill with random items, never repeating an item within 3 adjacent
    // rows — so the slowdown never shows the same item twice near the marker.
    const rows: Item[] = [];

    for (let k = 0; k < need; k++) {
      let candidate = randomItem();

      for (let guard = 0; guard < 40; guard++) {
        const clash =
          rows[k - 1]?.id === candidate.id ||
          rows[k - 2]?.id === candidate.id ||
          rows[k - 3]?.id === candidate.id;

        if (!clash) {
          break;
        }

        candidate = randomItem();
      }

      rows[k] = candidate;
    }

    // Drop the winner in, then keep its neighbours distinct from it.
    rows[target] = winner;

    for (const n of [target - 2, target - 1, target + 1, target + 2]) {
      if (rows[n] && rows[n].id === winner.id) {
        for (let guard = 0; guard < 40; guard++) {
          rows[n] = randomItem();

          if (rows[n].id !== winner.id) {
            break;
          }
        }
      }
    }

    return { strip: rows, targetIndex: target };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Land the target row in the middle band of the 3-row window.
  const offset = spin ? (targetIndex - Math.floor(VISIBLE_ROWS / 2)) * ITEM_HEIGHT : 0;

  return (
    <div
      className={`reel-container ov-reel ${
        landed ? `ov-reel--landed repair-${repair || 'none'}` : ''
      }`}
    >
      <h2 className="reel-title">{SLOT_LABEL[result.slot]}</h2>

      <div className="reel-wrapper">
        {showEffects && (
          <>
            <img className="winning-gif" src="/gifs/sparkles-02.gif" alt="" />
            <img className="winning-gif" src="/gifs/sparkles-00.gif" alt="" />

            {effects.map((effect) => (
              <img
                key={effect.id}
                className="winning-effect"
                src={`/gifs/effects/effect-${effect.id}.gif`}
                alt=""
                style={{
                  left: `${effect.left}%`,
                  top: `${effect.top}%`,
                  transform: `translate(-50%, -50%) rotate(${effect.rotation}deg)`,
                  animationDelay: `${effect.delay}s`,
                }}
              />
            ))}
          </>
        )}

        <div className="reel-window">
          <div
            className="reel"
            style={{
              transform: `translateY(-${offset}px)`,
              transition: spin
                ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.18, 1)`
                : 'none',
            }}
          >
            {strip.map((item, index) => (
              <div className="reel-item" key={index}>
                <img src={`/${folder}/${item.id}.png`} alt="" onError={hideBrokenImage} />
                <span>{item.name}</span>
              </div>
            ))}
          </div>

          <div className="top-gradient" />
          <div className="bottom-gradient" />
          <div className="reel-indicator" />
        </div>
      </div>

      <div className={`ov-result ${landed ? 'is-shown' : ''}`}>
        <img src={`/${folder}/${result.itemId}.png`} alt="" onError={hideBrokenImage} />
        <span>{targetName}</span>
      </div>
    </div>
  );
}

/* ========================================
   SPAWN REEL  (text only — mutant / enemy group)
======================================== */

interface SpawnReelProps {
  title: string;
  pool: string[];
  target: string;
  spin: boolean;
  landed: boolean;
}

function SpawnReel({ title, pool, target, spin, landed }: SpawnReelProps) {
  const fillPool = useMemo(() => {
    const names = (pool && pool.length > 0 ? pool : [target]).map((n) =>
      n.toUpperCase(),
    );

    return names.length > 0 ? names : ['???'];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [effects, setEffects] = useState<WinningEffect[]>([]);
  const [showEffects, setShowEffects] = useState<boolean>(false);

  useEffect(() => {
    if (!landed) {
      return;
    }

    const burst = shuffle(Array.from({ length: EFFECT_COUNT }, (_, index) => index))
      .slice(0, WINNING_EFFECTS_COUNT)
      .map((id, index) => ({
        id,
        left: 10 + Math.random() * 80,
        top: 10 + Math.random() * 80,
        rotation: -25 + Math.random() * 50,
        delay: index * 0.12,
      }));

    setEffects(burst);
    setShowEffects(true);

    const timer = window.setTimeout(() => {
      setShowEffects(false);
      setEffects([]);
    }, EFFECTS_MS);

    return () => window.clearTimeout(timer);
  }, [landed]);

  const { strip, targetIndex } = useMemo(() => {
    const jitter = Math.round((Math.random() * 2 - 1) * SPIN_JITTER_ROWS);
    const target_ = Math.round(SPIN_DISTANCE_PX / ITEM_HEIGHT) + jitter;

    const need = target_ + VISIBLE_ROWS + 2;
    const pickRandom = (): string =>
      fillPool[Math.floor(Math.random() * fillPool.length)];

    const rows: string[] = [];

    for (let k = 0; k < need; k++) {
      let candidate = pickRandom();

      for (let guard = 0; guard < 40; guard++) {
        if (rows[k - 1] !== candidate && rows[k - 2] !== candidate) {
          break;
        }

        candidate = pickRandom();
      }

      rows[k] = candidate;
    }

    rows[target_] = target.toUpperCase();

    return { strip: rows, targetIndex: target_ };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const offset = spin ? (targetIndex - Math.floor(VISIBLE_ROWS / 2)) * ITEM_HEIGHT : 0;

  return (
    <div className={`reel-container ov-reel ov-spawn ${landed ? 'ov-reel--landed ov-spawn--landed' : ''}`}>
      <h2 className="reel-title">{title}</h2>

      <div className="reel-wrapper">
        {showEffects && (
          <>
            <img className="winning-gif" src="/gifs/sparkles-02.gif" alt="" />
            <img className="winning-gif" src="/gifs/sparkles-00.gif" alt="" />

            {effects.map((effect) => (
              <img
                key={effect.id}
                className="winning-effect"
                src={`/gifs/effects/effect-${effect.id}.gif`}
                alt=""
                style={{
                  left: `${effect.left}%`,
                  top: `${effect.top}%`,
                  transform: `translate(-50%, -50%) rotate(${effect.rotation}deg)`,
                  animationDelay: `${effect.delay}s`,
                }}
              />
            ))}
          </>
        )}

        <div className="reel-window">
          <div
            className="reel"
            style={{
              transform: `translateY(-${offset}px)`,
              transition: spin
                ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.18, 1)`
                : 'none',
            }}
          >
            {strip.map((name, index) => (
              <div className="reel-item ov-spawn-item" key={index}>
                <span>{name}</span>
              </div>
            ))}
          </div>

          <div className="top-gradient" />
          <div className="bottom-gradient" />
          <div className="reel-indicator" />
        </div>
      </div>

      <div className={`ov-result ${landed ? 'is-shown' : ''}`}>
        <span>{target.toUpperCase()}</span>
      </div>
    </div>
  );
}

/* ========================================
   OVERLAY
======================================== */

export default function Overlay() {
  const [job, setJob] = useState<Job | null>(null);
  const [phase, setPhase] = useState<'idle' | 'active' | 'out'>('idle');
  const [spinning, setSpinning] = useState<boolean[]>([]);
  const [landed, setLanded] = useState<boolean[]>([]);

  const timers = useRef<number[]>([]);
  const ranJobs = useRef<Set<string>>(new Set());

  const clearTimers = (): void => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const runJob = (nextJob: Job): void => {
    // Never run a job id twice — a redelivered SSE `roll`, or a `hello`
    // fired on reconnect, must not replay the animation or the sound.
    if (!nextJob || ranJobs.current.has(nextJob.id)) {
      return;
    }

    if (ranJobs.current.size > 200) {
      ranJobs.current.clear();
    }

    ranJobs.current.add(nextJob.id);
    clearTimers();

    const count = nextJob.results.length;

    setJob(nextJob);
    setPhase('active');
    setSpinning(new Array(count).fill(false));
    setLanded(new Array(count).fill(false));

    let cursor = LEAD_MS;

    for (let i = 0; i < count; i++) {
      const start = cursor;

      timers.current.push(
        window.setTimeout(() => {
          setSpinning((prev) => prev.map((value, k) => (k === i ? true : value)));
          playSpinSound();
        }, start),
      );

      timers.current.push(
        window.setTimeout(() => {
          setLanded((prev) => prev.map((value, k) => (k === i ? true : value)));
        }, start + SPIN_MS),
      );

      cursor = start + SPIN_MS + GAP_MS;
    }

    const allLandedAt = cursor - GAP_MS;

    // The moment every reel has stopped: tell the server to hand the
    // loadout to the game now — don't make it wait for the fade-out.
    timers.current.push(
      window.setTimeout(() => {
        fetch(`${API}/overlay/rolled`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: nextJob.id }),
        }).catch(() => {
          // server may be gone; nothing to do
        });
      }, allLandedAt),
    );

    timers.current.push(
      window.setTimeout(() => {
        setPhase('out');
      }, cursor + HOLD_MS),
    );

    timers.current.push(
      window.setTimeout(() => {
        setPhase('idle');
        setJob(null);

        fetch(`${API}/overlay/done`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: nextJob.id }),
        }).catch(() => {
          // server may be gone; nothing to do
        });
      }, cursor + HOLD_MS + FADE_MS),
    );
  };

  useEffect(() => {
    const source = new EventSource(`${API}/overlay/stream`);

    source.addEventListener('roll', (event) => {
      runJob(JSON.parse((event as MessageEvent).data));
    });

    source.addEventListener('hello', (event) => {
      const state = JSON.parse((event as MessageEvent).data);

      if (state && state.current) {
        runJob(state.current);
      }
    });

    return () => {
      source.close();
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!job || phase === 'idle') {
    return null;
  }

  return (
    <div className={`ov-root ${phase === 'out' ? 'ov-root--out' : 'ov-root--in'}`}>
      <div className="ov-banner">
        <span className="ov-banner-user">{job.user}</span>
        <span className="ov-banner-label">{job.label}</span>
      </div>

      <div className="ov-reels">
        {job.mode === 'spawn' ? (
          <SpawnReel
            title={job.category === 'enemies' ? 'Enemies' : 'Mutants'}
            pool={job.spawnPool ?? []}
            target={job.results[0]?.name ?? '???'}
            spin={spinning[0] ?? false}
            landed={landed[0] ?? false}
          />
        ) : (
          job.results.map((result, index) => (
            <Reel
              key={`${job.id}-${index}`}
              result={result}
              grades={job.grades?.[result.slot]}
              spin={spinning[index] ?? false}
              landed={landed[index] ?? false}
            />
          ))
        )}
      </div>
    </div>
  );
}
