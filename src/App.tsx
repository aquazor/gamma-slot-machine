import { useMemo, useRef, useState } from 'react';
import './App.css';

import { pistols, shotguns, smgs, rifles, snipers } from './constants';

const ITEM_HEIGHT = 80;
const SPIN_DURATION = 6000;
const STORAGE_KEY = 'weapon-slot-machine-results';
const EFFECT_COUNT = 46;
const WINNING_EFFECTS_COUNT = 12;

interface Weapon {
  id: string;
  name: string;
  repair: string;
  ammo: string;
}

interface SlotReelProps {
  items: Weapon[];
  title: string;
  savedWeaponId?: string;
  onResult: (weaponId: string) => void;
}

interface WeaponCategory {
  name: string;
  items: Weapon[];
}

interface WinningEffect {
  id: number;
  left: number;
  top: number;
  rotation: number;
  delay: number;
}

/* ========================================
   SHUFFLE
======================================== */

const shuffle = <T,>(array: T[]): T[] => {
  const shuffled = [...array];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
};

/* ========================================
   WEAPON CATEGORIES
======================================== */

const weaponCategories: WeaponCategory[] = [
  {
    name: 'Pistols',
    items: pistols,
  },
  {
    name: 'Shotguns',
    items: shotguns,
  },
  {
    name: 'SMGs',
    items: smgs,
  },
  {
    name: 'Rifles',
    items: rifles,
  },
  {
    name: 'Snipers',
    items: snipers,
  },
];

/* ========================================
   SLOT REEL
======================================== */

function giveWeapon(itemId: string): void {
  console.log('Giving weapon with ID:', itemId);

  fetch('http://localhost:3000/give', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ itemId }),
  })
    .then((response) => response.json())
    .then((data) => {
      console.log('Weapon given:', data);
    })
    .catch((error) => {
      console.error('Error giving weapon:', error);
    });
}

/* ========================================
   SLOT REEL
======================================== */

function SlotReel({ items, title, savedWeaponId, onResult }: SlotReelProps) {
  /*
   * Shuffle weapons once when the slot loads.
   */
  const shuffledItems = useMemo(() => shuffle(items), [items]);

  /*
   * Spin sound.
   */
  const spinSound = useRef<HTMLAudioElement | null>(null);

  const playSpinSound = (): void => {
    if (!spinSound.current) {
      spinSound.current = new Audio('/sounds/spin.mp3');
      spinSound.current.preload = 'auto';
    }

    spinSound.current.currentTime = 0;
    spinSound.current.volume = 0.3;

    void spinSound.current.play();
  };

  /*
   * Find the saved weapon inside the
   * newly shuffled array.
   */
  const initialSelectedIndex = useMemo(() => {
    if (!savedWeaponId) {
      return 0;
    }

    const savedIndex = shuffledItems.findIndex((item) => item.id === savedWeaponId);

    return savedIndex >= 0 ? savedIndex : 0;
  }, [shuffledItems, savedWeaponId]);

  const [hasSpun, setHasSpun] = useState<boolean>(!!savedWeaponId);

  const [selectedIndex, setSelectedIndex] = useState<number>(initialSelectedIndex);

  const [spinning, setSpinning] = useState<boolean>(false);

  const [copied, setCopied] = useState<boolean>(false);

  const [showWinningGif, setShowWinningGif] = useState<boolean>(false);

  const [winningEffects, setWinningEffects] = useState<WinningEffect[]>([]);

  const initialPosition =
    shuffledItems.length * 10 * ITEM_HEIGHT + initialSelectedIndex * ITEM_HEIGHT;

  const [position, setPosition] = useState<number>(initialPosition);

  /*
   * Repeat shuffled weapons.
   */
  const repeatedItems = useMemo<Weapon[]>(() => {
    return Array.from({ length: 20 }, () => shuffledItems).flat();
  }, [shuffledItems]);

  /* ========================================
     SPIN
  ======================================== */

  const spin = (): void => {
    if (spinning || shuffledItems.length === 0) {
      return;
    }

    setSpinning(true);
    setCopied(false);

    playSpinSound();

    const targetIndex = Math.floor(Math.random() * shuffledItems.length);

    const currentAbsoluteIndex = Math.round(position / ITEM_HEIGHT);

    const currentCycle = Math.floor(currentAbsoluteIndex / shuffledItems.length);

    const rotations = 5 + Math.floor(Math.random() * 3);

    const targetCycle = currentCycle + rotations;

    const targetAbsoluteIndex = targetCycle * shuffledItems.length + targetIndex;

    const targetPosition = targetAbsoluteIndex * ITEM_HEIGHT;

    setPosition(targetPosition);

    setTimeout(() => {
      const weapon = shuffledItems[targetIndex];

      setSelectedIndex(targetIndex);
      setSpinning(false);
      setHasSpun(true);

      onResult(weapon.id);

      setShowWinningGif(true);

      const effects = shuffle(Array.from({ length: EFFECT_COUNT }, (_, index) => index))
        .slice(0, WINNING_EFFECTS_COUNT)
        .map((id) => ({
          id,
          left: 10 + Math.random() * 80,
          top: 10 + Math.random() * 80,
          rotation: -25 + Math.random() * 50,
          delay: Math.random() * 0.3,
        }));

      setWinningEffects(effects);
      setShowWinningGif(true);

      window.setTimeout(() => {
        setShowWinningGif(false);
        setWinningEffects([]);
      }, 5000);

      const normalizedCycle = 10;

      const normalizedIndex = normalizedCycle * shuffledItems.length + targetIndex;

      setPosition(normalizedIndex * ITEM_HEIGHT);
    }, SPIN_DURATION);
  };
  /* ========================================
     COPY ID
  ======================================== */

  const copyId = async (): Promise<void> => {
    const weapon = shuffledItems[selectedIndex];

    if (!weapon) {
      return;
    }

    try {
      await navigator.clipboard.writeText(weapon.id);

      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch (error) {
      console.error('Failed to copy ID:', error);
    }
  };

  const selectedItem = shuffledItems[selectedIndex];

  return (
    <div className="reel-container">
      <h2 className="reel-title">{title}</h2>

      {/* SLOT */}
      <div className="reel-wrapper">
        {showWinningGif && (
          <>
            <img className="winning-gif" src="/gifs/sparkles.gif" alt="" />

            {winningEffects.map((effect) => (
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
              transform: `translateY(-${position - ITEM_HEIGHT}px)`,

              transition: spinning
                ? `transform ${SPIN_DURATION}ms cubic-bezier(0.12, 0.8, 0.18, 1)`
                : 'none',
            }}
          >
            {repeatedItems.map((item, index) => (
              <div className="reel-item" key={`${item.id}-${index}`}>
                <img src={`/wpn-icons/${item.id}.png`} alt={item.name} />

                <span>{item.name}</span>
              </div>
            ))}
          </div>

          <div className="top-gradient" />
          <div className="bottom-gradient" />

          <div className="reel-indicator" />
        </div>
      </div>

      {/* SPIN BUTTON */}

      <button className="spin-button" onClick={spin} disabled={spinning}>
        {spinning ? 'SPINNING...' : 'SPIN'}
      </button>

      {/* RESULT */}

      <div
        className={`selected-box ${
          hasSpun ? `repair-${selectedItem?.repair ?? 'none'}` : 'no-result'
        }`}
      >
        {hasSpun && selectedItem ? (
          <>
            <img
              className="selected-image"
              src={`/wpn-icons/${selectedItem.id}.png`}
              alt={selectedItem.name}
            />

            <div className="selected-info">
              <div className="selected-name">{selectedItem.name}</div>

              <div className="selected-id">{selectedItem.id}</div>

              <button className="action-button" onClick={copyId}>
                {copied ? 'COPIED!' : 'COPY ID'}
              </button>

              <button
                className="action-button"
                onClick={() => giveWeapon(selectedItem.id)}
              >
                GIVE WEAPON
              </button>
            </div>
          </>
        ) : (
          <div className="no-result-text">?</div>
        )}
      </div>
    </div>
  );
}

/* ========================================
   APP
======================================== */

export default function App() {
  const [savedResults, setSavedResults] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (!saved) {
        return {};
      }

      return JSON.parse(saved);
    } catch (error) {
      console.error('Failed to load saved results:', error);

      return {};
    }
  });

  /*
   * Used to tell SlotReel components that
   * the results have been reset.
   */
  const [resetKey, setResetKey] = useState<number>(0);

  /* ========================================
     SAVE RESULT
  ======================================== */

  const handleResult = (category: string, weaponId: string): void => {
    setSavedResults((previous) => {
      const next = {
        ...previous,
        [category]: weaponId,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));

      return next;
    });
  };

  /* ========================================
     RESET RESULTS
  ======================================== */

  const resetResults = (): void => {
    const confirmed = window.confirm('Are you sure you want to reset all saved results?');

    if (!confirmed) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);

    setSavedResults({});

    /*
     * Force all SlotReels to reshuffle
     * and reset.
     */
    setResetKey((previous) => previous + 1);
  };

  return (
    <div className="app">
      <div className="slot-machine">
        <div className="header">
          <h1 className="title">🎰 GAMMA Weapon Slot Machine</h1>

          <button className="reset-button" onClick={resetResults}>
            RESET RESULTS
          </button>
        </div>

        <div className="reels">
          {weaponCategories.map((category) => (
            <SlotReel
              key={`${category.name}-${resetKey}`}
              title={category.name}
              items={category.items}
              savedWeaponId={savedResults[category.name]}
              onResult={(weaponId) => handleResult(category.name, weaponId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
