import { useEffect, useMemo, useRef, useState } from 'react';
import './Overlay.css';

import { API } from './api';
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
const WOW_VOLUME = 0.5;
const EFFECT_COUNT = 101; // /gifs/effects/effect-0..100.gif
const WINNING_EFFECTS_COUNT = 16;
const EFFECTS_MS = 5000;
const EFFECT_STAGGER_S = 0.08; // delay between consecutive emotes in one burst

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
  // spawn/perk results only. An array (e.g. Food & Water's food+drink
  // pair) renders as an icon-only pair with no text — see IconOrPair.
  icon?: string | string[] | null;
  label?: string; // spawn results only — plain group name, no "x<count>"
  value?: number; // count-roll's count reel only — presence marks a count entry
  baseValue?: number; // count-roll only — the roll before a multiply/add bonus
  bonus?: JobBonus | null; // count-roll only — set only for a count-affecting bonus
}

interface SpawnOption {
  label: string;
  icon: string | string[] | null;
}

interface JobBonus {
  key: string;
  label: string;
  type: string;
}

interface Job {
  id: string;
  user: string;
  label: string;
  kind: string;
  mode?: 'loot' | 'spawn' | 'perk' | 'negative';
  category?: string;
  spawnPool?: SpawnOption[];
  perkPool?: SpawnOption[]; // perk roll's slot 1 (which perk) filler
  perkValuePool?: SpawnOption[]; // perk roll's slot 2 (its value) filler
  effectPool?: SpawnOption[]; // negative effect roll's slot 1 (which effect) filler
  effectValuePool?: SpawnOption[]; // negative effect roll's slot 2 (its value) filler
  preset?: string;
  grades?: Partial<Record<Slot, string[]>>;
  results: RollResult[];
  bonus?: JobBonus | null; // count-roll spawns AND perks — set whenever a bonus applied
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
  armor: [
    ...outfitsField,
    ...outfitsLight,
    ...outfitsMedium,
    ...outfitsHeavy,
    ...outfitsExo,
  ],
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

// What actually triggered the roll — separate from job.label (which is
// often just the reward/power-up title, e.g. "[SPIN] Spawn Squads" for
// BOTH a channel-point redemption and a Custom Power-up redemption, so
// the label alone can't tell them apart).
const KIND_INFO: Record<string, { text: string; className: string }> = {
  reward: { text: 'Channel Points', className: 'ov-kind--points' },
  power_up: { text: 'Bits Power-up', className: 'ov-kind--bits' },
  subscribe: { text: 'New Sub', className: 'ov-kind--sub' },
  resub: { text: 'Resub', className: 'ov-kind--sub' },
  gift: { text: 'Gift Sub', className: 'ov-kind--sub' },
  manual: { text: 'Manual', className: 'ov-kind--manual' },
  'manual-spawn': { text: 'Manual', className: 'ov-kind--manual' },
  'manual-perk': { text: 'Manual', className: 'ov-kind--manual' },
  'manual-negative': { text: 'Manual', className: 'ov-kind--manual' },
};

function kindInfo(kind: string): { text: string; className: string } {
  return KIND_INFO[kind] ?? { text: kind, className: 'ov-kind--manual' };
}

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

// Sparkles + emote burst: starts when `landed` flips to true and clears
// itself after EFFECTS_MS.
function useWinningEffects(landed: boolean): {
  effects: WinningEffect[];
  showEffects: boolean;
} {
  const [effects, setEffects] = useState<WinningEffect[]>([]);

  useEffect(() => {
    if (!landed) {
      return;
    }

    // State is set from timers, not synchronously in the effect body.
    const startTimer = window.setTimeout(() => {
      setEffects(
        shuffle(Array.from({ length: EFFECT_COUNT }, (_, index) => index))
          .slice(0, WINNING_EFFECTS_COUNT)
          .map((id, index) => ({
            id,
            left: 10 + Math.random() * 80,
            top: 10 + Math.random() * 80,
            rotation: -25 + Math.random() * 50,
            delay: index * EFFECT_STAGGER_S,
          })),
      );
    }, 0);

    const endTimer = window.setTimeout(() => setEffects([]), EFFECTS_MS);

    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(endTimer);
    };
  }, [landed]);

  return { effects, showEffects: effects.length > 0 };
}

function hideBrokenImage(event: React.SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.style.visibility = 'hidden';
}

// A `string[]` icon (e.g. Food & Water's food+drink pair) renders as the
// icons side by side with a "+" between them and no text — a single
// string/null renders exactly as before.
function ReelIcon({ icon }: { icon: string | string[] | null | undefined }) {
  if (!icon) {
    return null;
  }

  if (Array.isArray(icon)) {
    return (
      <span className="ov-icon-pair">
        {icon.map((src, index) => (
          <span className="ov-icon-pair-item" key={index}>
            {index > 0 && <span className="ov-icon-pair-plus">+</span>}
            {src && <img src={src} alt="" onError={hideBrokenImage} />}
          </span>
        ))}
      </span>
    );
  }

  return <img src={icon} alt="" onError={hideBrokenImage} />;
}

function playSound(src: string, volume: number): void {
  try {
    const audio = new Audio(src);
    audio.volume = volume;

    void audio.play().catch(() => {
      // autoplay blocked outside OBS until a user gesture
    });
  } catch {
    // no audio available
  }
}

function playSpinSound(): void {
  playSound('/sounds/spin.mp3', SPIN_VOLUME);
}

// Plays once per roll, after the LAST reel has landed — not per reel.
function playWowSound(): void {
  playSound('/sounds/wow.mp3', WOW_VOLUME);
}

/* ========================================
   SHARED REEL PIECES
======================================== */

// Strip: random rows for a FIXED scroll distance (so every reel spins at
// the same visual speed), the winning row at that distance, then a few
// more rows so the window is never half-empty after it lands. Filler never
// repeats an item within `clashRows` adjacent rows, and the winner's
// neighbours are kept distinct from it.
function buildStrip<T>(
  fillPool: T[],
  winner: T,
  isSame: (a: T, b: T) => boolean,
  clashRows: number,
): { strip: T[]; targetIndex: number } {
  const jitter = Math.round((Math.random() * 2 - 1) * SPIN_JITTER_ROWS);
  const target = Math.round(SPIN_DISTANCE_PX / ITEM_HEIGHT) + jitter;

  const need = target + VISIBLE_ROWS + 2;

  const randomItem = (): T => fillPool[Math.floor(Math.random() * fillPool.length)];

  const rows: T[] = [];

  for (let k = 0; k < need; k++) {
    let candidate = randomItem();

    for (let guard = 0; guard < 40; guard++) {
      const clash = Array.from({ length: clashRows }, (_, i) => rows[k - 1 - i]).some(
        (row) => row !== undefined && isSame(row, candidate),
      );

      if (!clash) {
        break;
      }

      candidate = randomItem();
    }

    rows[k] = candidate;
  }

  rows[target] = winner;

  for (const n of [target - 2, target - 1, target + 1, target + 2]) {
    if (rows[n] && isSame(rows[n], winner)) {
      for (let guard = 0; guard < 40; guard++) {
        rows[n] = randomItem();

        if (!isSame(rows[n], winner)) {
          break;
        }
      }
    }
  }

  return { strip: rows, targetIndex: target };
}

// Sparkles + emote burst over the reel once it has landed.
function ReelEffects({ landed }: { landed: boolean }) {
  const { effects, showEffects } = useWinningEffects(landed);

  if (!showEffects) {
    return null;
  }

  return (
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
  );
}

interface ReelShellProps {
  className: string;
  title: string;
  landed: boolean;
  spin: boolean;
  targetIndex: number;
  withEffects?: boolean;
  hidden?: boolean; // mask the pool until this reel's own turn starts — see PendingMask
  result: React.ReactNode; // contents of the line under the reel
  children: React.ReactNode; // the strip's rows
}

// The frame every reel shares: title, scrolling window (+ gradients and
// marker), and the result line that fades in once it has landed.
function ReelShell({
  className,
  title,
  landed,
  spin,
  targetIndex,
  withEffects = false,
  hidden = false,
  result,
  children,
}: ReelShellProps) {
  // Land the target row in the middle band of the 3-row window.
  const offset = spin ? (targetIndex - Math.floor(VISIBLE_ROWS / 2)) * ITEM_HEIGHT : 0;

  return (
    <div className={`reel-container ov-reel ${className} ${landed ? 'ov-reel--landed' : ''}`}>
      <h2 className="reel-title">{title}</h2>

      <div className="reel-wrapper">
        {withEffects && <ReelEffects landed={landed} />}

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
            {children}
          </div>

          <div className="top-gradient" />
          <div className="bottom-gradient" />
          <div className="reel-indicator" />

          {hidden && <PendingMask />}
        </div>
      </div>

      <div className={`ov-result ${landed ? 'is-shown' : ''}`}>{result}</div>
    </div>
  );
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

  const { strip, targetIndex } = useMemo(
    () =>
      buildStrip<Item>(
        fillPool,
        real ?? { id: result.itemId, name: targetName },
        (a, b) => a.id === b.id,
        3,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <ReelShell
      className={landed ? `repair-${repair || 'none'}` : ''}
      title={SLOT_LABEL[result.slot]}
      landed={landed}
      spin={spin}
      targetIndex={targetIndex}
      withEffects
      result={
        <>
          <img src={`/${folder}/${result.itemId}.png`} alt="" onError={hideBrokenImage} />
          <span>{targetName}</span>
        </>
      }
    >
      {strip.map((item, index) => (
        <div className="reel-item" key={index}>
          <img src={`/${folder}/${item.id}.png`} alt="" onError={hideBrokenImage} />
          <span>{item.name}</span>
        </div>
      ))}
    </ReelShell>
  );
}

/* ========================================
   SPAWN REEL  (text only — mutant / enemy group)
======================================== */

interface SpawnReelProps {
  title: string;
  pool: SpawnOption[];
  label: string; // plain group name shown in the reel, e.g. "Boars"
  resultText: string; // label + count for the line below, e.g. "BOARS x2"
  targetIcon?: string | string[] | null;
  spin: boolean;
  landed: boolean;
  hidden?: boolean; // mask the pool until this reel's own turn starts — see PendingMask
}

function SpawnReel({
  title,
  pool,
  label,
  resultText,
  targetIcon,
  spin,
  landed,
  hidden,
}: SpawnReelProps) {
  const fillPool = useMemo(() => {
    const options = (
      pool && pool.length > 0 ? pool : [{ label, icon: targetIcon ?? null }]
    ).map((o) => ({ label: o.label.toUpperCase(), icon: o.icon }));

    return options.length > 0 ? options : [{ label: '???', icon: null }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { strip, targetIndex } = useMemo(
    () =>
      buildStrip<SpawnOption>(
        fillPool,
        { label: label.toUpperCase(), icon: targetIcon ?? null },
        (a, b) => a.label === b.label,
        2,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <ReelShell
      className={`ov-spawn ${landed ? 'ov-spawn--landed' : ''}`}
      title={title}
      landed={landed}
      spin={spin}
      targetIndex={targetIndex}
      withEffects
      hidden={hidden}
      result={
        <>
          <ReelIcon icon={targetIcon} />
          {resultText && <span>{resultText}</span>}
        </>
      }
    >
      {strip.map((option, index) => (
        <div className="reel-item ov-spawn-item" key={index}>
          <ReelIcon icon={option.icon} />
          {option.label && <span>{option.label}</span>}
        </div>
      ))}
    </ReelShell>
  );
}

/* ========================================
   COUNT REEL  (numeric — how many spawn, mode 2 only)
======================================== */

interface CountReelProps {
  title: string;
  target: number; // final count (shown in the result line under the reel)
  baseTarget: number; // pre-bonus roll — what the reel itself lands on
  bonusLabel?: string | null; // e.g. "x2" — only set for a count-affecting bonus
  spin: boolean;
  landed: boolean;
  hidden?: boolean; // mask the pool until this reel's own turn starts — see PendingMask
}

// Pure filler for the spin — the reel only ever actually lands on the
// real rolled count (see `winnerLabel` below). These are just what
// flies past while it spins, so a couple of joke/meme values are fine.
const COUNT_FILLER = [
  'x1',
  'x2',
  'x3',
  'x4',
  'x5',
  'x10',
  'x100',
  'x1000',
  'x67',
  'x69',
  'x1337',
  'x52',
  'x600',
  'Лям двести',
];

function CountReel({
  title,
  target,
  baseTarget,
  bonusLabel,
  spin,
  landed,
  hidden,
}: CountReelProps) {
  // The reel visually lands on the roll BEFORE the bonus, with the
  // bonus called out — the actually-final number only shows in the
  // result line below (matches how the species reel already shows the
  // full "BOARS x4 (x2 bonus)" text only in its own result line).
  const winnerLabel = bonusLabel
    ? `x${baseTarget} (${bonusLabel} bonus)`
    : `x${baseTarget}`;

  const { strip, targetIndex } = useMemo(
    () => buildStrip<string>(COUNT_FILLER, winnerLabel, (a, b) => a === b, 2),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <ReelShell
      className={`ov-count ${landed ? 'ov-count--landed' : ''}`}
      title={title}
      landed={landed}
      spin={spin}
      targetIndex={targetIndex}
      hidden={hidden}
      result={<span>x{target}</span>}
    >
      {strip.map((label, index) => (
        <div className="reel-item ov-count-item" key={index}>
          <span>{label}</span>
        </div>
      ))}
    </ReelShell>
  );
}

/* ========================================
   PENDING MASK  (covers a reel's pool until its own turn starts)
======================================== */
// A later reel in a multi-slot roll (e.g. perks' "Amount") mounts before
// its own turn starts — its filler pool would otherwise sit fully visible
// at rest and give away what category just landed on the reel before it
// (dollar amounts vs seconds vs item names). This overlays "???" rows on
// top of the ALREADY-MOUNTED reel instead of swapping in a different
// component for it — swapping components would mean the real reel first
// mounts at the very moment it starts spinning, with no "at rest" frame
// beforehand for the CSS transition to animate from, so it'd just snap to
// its landed position instead of visibly spinning.

function PendingMask() {
  return (
    <div className="ov-reel-mask">
      {[0, 1, 2].map((i) => (
        <div className="reel-item ov-pending-item" key={i}>
          <span>?</span>
        </div>
      ))}
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

    // The moment every reel has stopped: celebrate once, and tell the
    // server to hand the loadout to the game now — don't make it wait
    // for the fade-out.
    timers.current.push(
      window.setTimeout(() => {
        playWowSound();

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
      window.setTimeout(
        () => {
          setPhase('idle');
          setJob(null);

          fetch(`${API}/overlay/done`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: nextJob.id }),
          }).catch(() => {
            // server may be gone; nothing to do
          });
        },
        cursor + HOLD_MS + FADE_MS,
      ),
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
    <div
      className={`ov-root ${phase === 'out' ? 'ov-root--out' : 'ov-root--in'} ${
        job.bonus ? 'ov-root--bonus' : ''
      }`}
    >
      <div className="ov-banner">
        <span className={`ov-banner-kind ${kindInfo(job.kind).className}`}>
          {kindInfo(job.kind).text}
        </span>
        <span className="ov-banner-user">{job.user}</span>
        <span className="ov-banner-label">{job.label}</span>
        {job.bonus && (
          <span className="ov-banner-bonus">
            BONUS{job.bonus.label ? ` ${job.bonus.label}` : ''}
          </span>
        )}
      </div>

      <div className="ov-reels">
        {job.mode === 'spawn'
          ? job.results.map((result, index) => {
              const started = (spinning[index] ?? false) || (landed[index] ?? false);

              return typeof result.value === 'number' ? (
                <CountReel
                  key={`${job.id}-${index}`}
                  title="Count"
                  target={result.value}
                  baseTarget={result.baseValue ?? result.value}
                  bonusLabel={result.bonus?.label ?? null}
                  spin={spinning[index] ?? false}
                  landed={landed[index] ?? false}
                  hidden={!started}
                />
              ) : (
                <SpawnReel
                  key={`${job.id}-${index}`}
                  title={job.category === 'enemies' ? 'Enemies' : 'Mutants'}
                  pool={job.spawnPool ?? []}
                  label={result.label ?? result.name ?? '???'}
                  resultText={result.name ?? '???'}
                  targetIcon={result.icon}
                  spin={spinning[index] ?? false}
                  landed={landed[index] ?? false}
                  hidden={!started}
                />
              );
            })
          : job.mode === 'perk'
            ? // slot 0 = which perk, slot 1 = that perk's rolled value —
              // fixed two-entry shape built by _buildPerkJob in roulette.cjs.
              // Slot 1 stays masked until it's actually spinning/landed — its
              // pool's format (dollars vs seconds vs item names) would
              // otherwise give away slot 0's result before it even lands.
              job.results.map((result, index) => {
                const title = index === 1 ? 'Amount' : 'Positive Effect';
                const started = (spinning[index] ?? false) || (landed[index] ?? false);

                return (
                  <SpawnReel
                    key={`${job.id}-${index}`}
                    title={title}
                    pool={(index === 1 ? job.perkValuePool : job.perkPool) ?? []}
                    label={result.label ?? result.name ?? '???'}
                    resultText={result.name ?? '???'}
                    targetIcon={result.icon}
                    spin={spinning[index] ?? false}
                    landed={landed[index] ?? false}
                    hidden={!started}
                  />
                );
              })
            : job.mode === 'negative'
              ? // slot 0 = which effect, slot 1 (if present) = that effect's
                // rolled value — some effects (Drop Weapon, Empty Pockets) have
                // no second roll at all, so `job.results` may be length 1; the
                // spin/landed timing in runJob already keys off results.length,
                // so a single-entry job just plays one reel.
                job.results.map((result, index) => {
                  const title = index === 1 ? 'Amount' : 'Negative Effect';
                  const started = (spinning[index] ?? false) || (landed[index] ?? false);

                  return (
                    <SpawnReel
                      key={`${job.id}-${index}`}
                      title={title}
                      pool={(index === 1 ? job.effectValuePool : job.effectPool) ?? []}
                      label={result.label ?? result.name ?? '???'}
                      resultText={result.name ?? '???'}
                      targetIcon={result.icon}
                      spin={spinning[index] ?? false}
                      landed={landed[index] ?? false}
                      hidden={!started}
                    />
                  );
                })
              : job.results.map((result, index) => (
                  <Reel
                    key={`${job.id}-${index}`}
                    result={result}
                    grades={job.grades?.[result.slot]}
                    spin={spinning[index] ?? false}
                    landed={landed[index] ?? false}
                  />
                ))}
      </div>
    </div>
  );
}
