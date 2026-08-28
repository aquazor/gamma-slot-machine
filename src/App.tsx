import { useMemo, useRef, useState } from 'react';
import './App.css';

import {
  pistols,
  shotguns,
  smgs,
  rifles,
  snipers,
  outfitsField,
  outfitsLight,
  outfitsMedium,
  outfitsHeavy,
  outfitsExo,
  loadouts,
} from './constants';

const ITEM_HEIGHT = 80;
const SPIN_DURATION = 6000;

const STORAGE_KEY = 'weapon-slot-machine-results';
const LOADOUT_STORAGE_KEY = 'weapon-slot-machine-loadout';

const EFFECT_COUNT = 46;
const WINNING_EFFECTS_COUNT = 12;

/* ========================================
   TYPES
======================================== */

interface Weapon {
  id: string;
  name: string;
  repair: string;
  ammo: string;
}

interface Outfit {
  id: string;
  name: string;
  faction: string;
  repair: string;
}

interface SlotReelProps {
  items: (Weapon | Outfit)[];
  title: string;
  savedItemId?: string;
  type: 'weapon' | 'outfit';
  onResult: (itemId: string) => void;
}

interface WeaponCategory {
  key: string;
  name: string;
  items: Weapon[];
}

interface OutfitCategory {
  key: string;
  name: string;
  repair: string;
  items: Outfit[];
}

interface Loadout {
  name: string;
  weapons: string[];
  outfits: string[];
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
    key: 'pistol',
    name: 'Pistols',
    items: pistols,
  },
  {
    key: 'shotgun',
    name: 'Shotguns',
    items: shotguns,
  },
  {
    key: 'smg',
    name: 'SMGs',
    items: smgs,
  },
  {
    key: 'rifle',
    name: 'Rifles',
    items: rifles,
  },
  {
    key: 'sniper',
    name: 'Snipers',
    items: snipers,
  },
];

/* ========================================
   OUTFIT CATEGORIES
======================================== */

const outfitCategories: OutfitCategory[] = [
  {
    key: 'field',
    name: 'Field',
    repair: 'F',
    items: outfitsField,
  },
  {
    key: 'light',
    name: 'Light',
    repair: 'L',
    items: outfitsLight,
  },
  {
    key: 'medium',
    name: 'Medium',
    repair: 'M',
    items: outfitsMedium,
  },
  {
    key: 'heavy',
    name: 'Heavy',
    repair: 'H',
    items: outfitsHeavy,
  },
  {
    key: 'exoskeleton',
    name: 'Exoskeleton',
    repair: 'E',
    items: outfitsExo,
  },
];

/* ========================================
   SLOT REEL
======================================== */

function SlotReel({ items, title, savedItemId, type, onResult }: SlotReelProps) {
  /*
   * Shuffle weapons/outfits once when the slot loads.
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
   * Find saved item inside the newly shuffled array.
   */
  const initialSelectedIndex = useMemo(() => {
    if (!savedItemId) {
      return 0;
    }

    const savedIndex = shuffledItems.findIndex((item) => item.id === savedItemId);

    return savedIndex >= 0 ? savedIndex : 0;
  }, [shuffledItems, savedItemId]);

  const [hasSpun, setHasSpun] = useState<boolean>(!!savedItemId);

  const [selectedIndex, setSelectedIndex] = useState<number>(initialSelectedIndex);

  const [spinning, setSpinning] = useState<boolean>(false);

  const [copied, setCopied] = useState<boolean>(false);

  const [showWinningGif, setShowWinningGif] = useState<boolean>(false);

  const [winningEffects, setWinningEffects] = useState<WinningEffect[]>([]);

  const initialPosition =
    shuffledItems.length * 10 * ITEM_HEIGHT + initialSelectedIndex * ITEM_HEIGHT;

  const [position, setPosition] = useState<number>(initialPosition);

  /*
   * Repeat shuffled items.
   */
  const repeatedItems = useMemo<(Weapon | Outfit)[]>(() => {
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
      const item = shuffledItems[targetIndex];

      setSelectedIndex(targetIndex);
      setSpinning(false);
      setHasSpun(true);

      onResult(item.id);

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

      /*
       * Normalize reel position after spin.
       */
      const normalizedCycle = 10;

      const normalizedIndex = normalizedCycle * shuffledItems.length + targetIndex;

      setPosition(normalizedIndex * ITEM_HEIGHT);
    }, SPIN_DURATION);
  };

  /* ========================================
     COPY ID
  ======================================== */

  const copyId = async (): Promise<void> => {
    const item = shuffledItems[selectedIndex];

    if (!item) {
      return;
    }

    try {
      await navigator.clipboard.writeText(item.id);

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
                <img
                  src={`/${
                    type === 'weapon' ? 'wpn-icons' : 'outfit-icons'
                  }/${item.id}.png`}
                  alt={item.name}
                />

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
          hasSpun
            ? `repair-${selectedItem?.repair?.toLowerCase() ?? 'none'}`
            : 'no-result'
        }`}
      >
        {hasSpun && selectedItem ? (
          <>
            <img
              className="selected-image"
              src={`/${
                type === 'weapon' ? 'wpn-icons' : 'outfit-icons'
              }/${selectedItem.id}.png`}
              alt={selectedItem.name}
            />

            <div className="selected-info">
              <div className="selected-name">{selectedItem.name}</div>

              <div className="selected-id">{selectedItem.id}</div>

              <button className="action-button" onClick={copyId}>
                {copied ? 'COPIED!' : 'COPY ID'}
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
  const [selectedLoadoutName, setSelectedLoadoutName] = useState<string>(() => {
    const savedLoadout = localStorage.getItem(LOADOUT_STORAGE_KEY);

    if (savedLoadout && loadouts.some((loadout) => loadout.name === savedLoadout)) {
      return savedLoadout;
    }

    return loadouts[loadouts.length - 1]?.name ?? '';
  });

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

  const [resetKey, setResetKey] = useState<number>(0);

  const [givingLoadout, setGivingLoadout] = useState<boolean>(false);

  /*
   * Find currently selected loadout.
   */
  const selectedLoadout: Loadout =
    loadouts.find((loadout) => loadout.name === selectedLoadoutName) ?? loadouts[0];

  /* ========================================
     SAVE RESULT
  ======================================== */

  const handleResult = (category: string, itemId: string): void => {
    setSavedResults((previous) => {
      const next = {
        ...previous,
        [category]: itemId,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));

      return next;
    });
  };

  /* ========================================
     GIVE LOADOUT
  ======================================== */

  const giveLoadout = async (): Promise<void> => {
    if (givingLoadout) {
      return;
    }

    /*
     * Only collect weapons that belong
     * to the currently selected loadout.
     */
    const weapons = weaponCategories
      .filter((category) => selectedLoadout.weapons.includes(category.key))
      .map((category) => {
        const itemId = savedResults[category.name];

        if (!itemId) {
          return null;
        }

        const weapon = category.items.find((item) => item.id === itemId);

        return weapon
          ? {
              itemId: weapon.id,
              ammo: weapon.ammo,
            }
          : null;
      })
      .filter(
        (
          weapon,
        ): weapon is {
          itemId: string;
          ammo: string;
        } => weapon !== null,
      );

    /*
     * Only collect outfits that belong
     * to the currently selected loadout.
     */
    const outfits = outfitCategories
      .filter((category) => selectedLoadout.outfits.includes(category.repair))
      .map((category) => {
        const itemId = savedResults[category.name];

        if (!itemId) {
          return null;
        }

        const outfit = category.items.find((item) => item.id === itemId);

        return outfit
          ? {
              itemId: outfit.id,
            }
          : null;
      })
      .filter(
        (
          outfit,
        ): outfit is {
          itemId: string;
        } => outfit !== null,
      );

    if (weapons.length === 0 && outfits.length === 0) {
      window.alert('Roll at least one item first.');

      return;
    }

    const loadout = {
      weapons,
      outfits,
    };

    setGivingLoadout(true);

    console.log('Giving loadout:', loadout);

    try {
      const response = await fetch('http://localhost:3000/give-loadout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(loadout),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to give loadout');
      }

      console.log('Loadout given:', data);
    } catch (error) {
      console.error('Error giving loadout:', error);

      window.alert('Failed to give loadout. Make sure GAMMA is running.');
    } finally {
      setGivingLoadout(false);
    }
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

    setResetKey((previous) => previous + 1);
  };

  /* ========================================
     LOADOUT CHANGE
  ======================================== */

  const handleLoadoutChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const loadoutName = event.target.value;

    setSelectedLoadoutName(loadoutName);

    localStorage.setItem(LOADOUT_STORAGE_KEY, loadoutName);
  };

  /*
   * Filter visible weapon slots.
   */
  const visibleWeaponCategories = weaponCategories.filter((category) =>
    selectedLoadout.weapons.includes(category.key),
  );

  /*
   * Filter visible outfit slots.
   */
  const visibleOutfitCategories = outfitCategories.filter((category) =>
    selectedLoadout.outfits.includes(category.repair),
  );

  return (
    <div className="app">
      <div className="slot-machine">
        <div className="header">
          <h1 className="title">🎰 GAMMA Weapon and Armor Slot Machine</h1>

          <button className="reset-button" onClick={resetResults}>
            RESET RESULTS
          </button>
        </div>

        {/* ========================================
            LOADOUT SELECTOR
        ======================================== */}

        <div className="loadout-selector">
          <label className="loadout-label" htmlFor="loadout-select">
            LOADOUT
          </label>

          <select
            id="loadout-select"
            className="loadout-select"
            value={selectedLoadoutName}
            onChange={handleLoadoutChange}
          >
            {loadouts.map((loadout, index) => (
              <option key={`${loadout.name}-${index}`} value={loadout.name}>
                {loadout.name}
              </option>
            ))}
          </select>
        </div>

        {/* ========================================
            WEAPONS
        ======================================== */}

        {visibleWeaponCategories.length > 0 && (
          <div className="reels">
            {visibleWeaponCategories.map((category) => (
              <SlotReel
                key={`${category.name}-${resetKey}`}
                title={category.name}
                items={category.items}
                savedItemId={savedResults[category.name]}
                type="weapon"
                onResult={(itemId) => handleResult(category.name, itemId)}
              />
            ))}
          </div>
        )}

        {/* ========================================
            OUTFITS
        ======================================== */}

        {visibleOutfitCategories.length > 0 && (
          <div className="reels">
            {visibleOutfitCategories.map((category) => (
              <SlotReel
                key={`${category.name}-${resetKey}`}
                title={category.name}
                items={category.items}
                savedItemId={savedResults[category.name]}
                type="outfit"
                onResult={(itemId) => handleResult(category.name, itemId)}
              />
            ))}
          </div>
        )}

        {/* ========================================
            GIVE LOADOUT
        ======================================== */}

        <div className="loadout-actions">
          <button
            className="give-loadout-button"
            onClick={giveLoadout}
            disabled={givingLoadout}
          >
            <span className="button-icon">🎁</span>

            {givingLoadout ? 'GIVING LOADOUT...' : 'GIVE LOADOUT'}
          </button>
        </div>
      </div>
    </div>
  );
}
