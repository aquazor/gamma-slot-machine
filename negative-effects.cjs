/*
 * ---------------------------------------------------------
 * NEGATIVE EFFECTS  (Drop Weapon / Empty Pockets / Break Item / Time Factor /
 * Drink Vodka / Junk Item)
 * ---------------------------------------------------------
 * Same dual-slot shape as positive-effects.cjs: slot 1 picks ONE effect
 * (weighted by each effect's own `chance` among enabled ones), slot 2
 * rolls that effect's own value — UNLESS the effect has no second roll
 * at all (Drop Weapon, Empty Pockets), in which case it's single-shot.
 * Junk Item's slot 2 IS the item roll (which junk item gets given).
 *
 * Definitions live in negative-effects.data.json, this module rolls
 * among them and turns the winner into gamma-bridge command lines — see
 * GAMMA MOD/gamedata/scripts/zzzzzz_slot_machine_bridge.script for the
 * matching DROP_WEAPON / BREAK_ITEM / TIME_FACTOR / EMPTY_POCKETS / ALCOHOL /
 * GIVE_JUNK line handlers.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function randInt(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);

  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function randFloat(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);

  return lo + Math.random() * (hi - lo);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/*
 * Pick at most one bonus from a `bonuses` list — same rules as
 * positive-effects.cjs's own rollWeightedBonus (duplicated here rather
 * than shared, matching how enemies-mode2.cjs/positive-effects.cjs each
 * keep their own copy): each entry claims its own slice of chance; under
 * 100% enabled, the leftover is "no bonus"; at/above 100%, a bonus is
 * always drawn, split proportionally by relative chance.
 */
function rollWeightedBonus(bonuses, forceGuaranteed) {
  const list = Array.isArray(bonuses) ? bonuses : [];
  const total = list.reduce((sum, b) => sum + (Number.isFinite(b.chance) ? b.chance : 0), 0);

  if (total <= 0) {
    return null;
  }

  if (forceGuaranteed || total >= 1) {
    let roll = Math.random() * total;

    for (const bonus of list) {
      if (roll < bonus.chance) {
        return bonus;
      }

      roll -= bonus.chance;
    }

    return list[list.length - 1]; // float-rounding fallback
  }

  let roll = Math.random();

  for (const bonus of list) {
    if (roll < bonus.chance) {
      return bonus;
    }

    roll -= bonus.chance;
  }

  return null;
}

const data = require('./negative-effects.data.json');

function effectKeys() {
  return Object.keys(data).filter((key) => !key.startsWith('_'));
}

function effectDef(key) {
  return data[key] || null;
}

function hasValueRoll(def) {
  return !def || def.hasValueRoll !== false;
}

/*
 * Enable/disable toggles, same "global by key" runtime-only model as
 * positive-effects.cjs's own perk toggles — resets on restart.
 */
const disabledEffectKeys = new Set();

function isEffectEnabled(key) {
  return !disabledEffectKeys.has(key);
}

function setEffectEnabled(key, enabled) {
  if (enabled) {
    disabledEffectKeys.delete(key);
  } else {
    disabledEffectKeys.add(key);
  }
}

/*
 * Chance overrides, by key — same override-file pattern as
 * positive-effects.cjs's perk-chance-overrides.json, stored separately
 * so the two effect types never collide.
 */
const CHANCE_OVERRIDES_PATH = path.join(
  os.homedir(),
  '.gamma-slot-machine',
  'negative-effect-chance-overrides.json',
);

function loadChanceOverrides() {
  try {
    return JSON.parse(fs.readFileSync(CHANCE_OVERRIDES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveChanceOverrides(overrides) {
  const dir = path.dirname(CHANCE_OVERRIDES_PATH);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(CHANCE_OVERRIDES_PATH, JSON.stringify(overrides, null, 2), 'utf8');
}

function effectiveChance(key, def) {
  const overrides = loadChanceOverrides();
  const override = overrides[key];
  const fallback = def && Number.isFinite(def.chance) ? def.chance : 1;

  return typeof override === 'number' ? override : fallback;
}

function setEffectChance(key, chance) {
  const clamped = Math.max(0, Math.min(1, Number(chance) || 0));

  const overrides = loadChanceOverrides();

  overrides[key] = clamped;
  saveChanceOverrides(overrides);
}

/*
 * "Restore defaults" for the whole section: re-enables every effect and
 * wipes every persisted chance override.
 */
function resetEffects() {
  disabledEffectKeys.clear();
  saveChanceOverrides({});
}

const EFFECT_DESCRIPTIONS = {
  'drop-weapon': "Drops whatever's currently in hand",
  'empty-pockets': 'Takes almost all the streamer\'s money (keeps a small floor) and drops it on the ground',
  'break-item': 'Damages the streamer\'s equipped armor or helmet',
  'time-factor': 'Speeds up or slows down in-game time for a while',
  alcohol: 'Instant drunk effect, no vodka required',
  'junk-item': 'Dead weight - a useless item takes up inventory space',
};

/*
 * Snapshot for the Settings UI.
 */
function listEffects() {
  return effectKeys().map((key) => {
    const def = effectDef(key);

    return {
      key,
      label: (def && def.label) || key,
      description: EFFECT_DESCRIPTIONS[key] || '',
      icon: (def && def.icon) || null,
      chance: effectiveChance(key, def),
      enabled: isEffectEnabled(key),
      hasValueRoll: hasValueRoll(def),
    };
  });
}

/*
 * Pick one enabled effect — weighted by each effect's own `chance`
 * (relative weight, same rules as positive-effects.cjs's rollPerk).
 * Returns null if every effect is disabled.
 */
function rollNegativeEffect() {
  const enabledKeys = effectKeys().filter((key) => isEffectEnabled(key));

  if (enabledKeys.length === 0) {
    return null;
  }

  const weights = enabledKeys.map((key) => Math.max(0, effectiveChance(key, effectDef(key))));

  const total = weights.reduce((sum, w) => sum + w, 0);

  let key;

  if (total <= 0) {
    key = enabledKeys[Math.floor(Math.random() * enabledKeys.length)];
  } else {
    let roll = Math.random() * total;

    key = enabledKeys[enabledKeys.length - 1]; // float-rounding fallback

    for (let i = 0; i < enabledKeys.length; i++) {
      if (roll < weights[i]) {
        key = enabledKeys[i];
        break;
      }

      roll -= weights[i];
    }
  }

  const def = effectDef(key);
  const label = (def && def.label) || key;

  return { key, label, icon: (def && def.icon) || null, def, hasValueRoll: hasValueRoll(def) };
}

/*
 * Roll effect-type-specific "slot 2" — the actual value this particular
 * roll landed on. Returns null for effects with no value roll at all
 * (Drop Weapon, Empty Pockets) — callers should check hasValueRoll first.
 *
 *   break-item:   value = a whole-percent 5-30 (item condition damage)
 *   time-factor:  value = the DURATION in seconds (shaped exactly like
 *                 Immortality: a base 30-60 roll plus a chance of a
 *                 +seconds/x2-duration bonus). The speed multiplier
 *                 itself (slower or faster, from `ranges`) is rolled
 *                 alongside it but never shown as "the roll" — it rides
 *                 along as `speedValue`, only used to build the
 *                 TIME_FACTOR command line.
 *   alcohol:      value = an alcohol amount to add (ChangeAlcohol)
 *
 * `forceBonus` (reserved for a future bits-power-up "always worst case"
 * treatment, same idea as positive-effects.cjs's own forceBonus) makes
 * Time Factor's bonus guaranteed instead of its normal per-roll chance.
 */
function rollEffectValue(key, forceBonus) {
  const def = effectDef(key);

  if (!def || !hasValueRoll(def)) {
    return null;
  }

  switch (key) {
    case 'break-item': {
      const percent = Math.round(randFloat(def.min, def.max));
      const bonus = rollWeightedBonus(def.bonuses, forceBonus);

      let finalPercent = percent;

      if (bonus && bonus.type === 'add') {
        finalPercent = percent + bonus.value;
      } else if (bonus && bonus.type === 'multiply') {
        finalPercent = percent * bonus.value;
      }

      finalPercent = Math.min(100, Math.round(finalPercent));

      return {
        value: finalPercent,
        label: bonus ? `-${percent}% (${bonus.label} bonus)` : `-${percent}%`,
        icon: null,
        bonus: bonus ? { key: bonus.key, label: bonus.label, type: bonus.type } : null,
        fullLabel: `-${finalPercent}%`,
      };
    }

    case 'time-factor': {
      const ranges = Array.isArray(def.ranges) ? def.ranges : [];

      if (ranges.length === 0) {
        return null;
      }

      const range = ranges[Math.floor(Math.random() * ranges.length)];
      const speedValue = round2(randFloat(range.min, range.max));

      const seconds = randInt(def.min, def.max);
      const bonus = rollWeightedBonus(def.bonuses, forceBonus);

      let finalSeconds = seconds;

      if (bonus && bonus.type === 'add') {
        finalSeconds = seconds + bonus.value;
      } else if (bonus && bonus.type === 'multiply') {
        // x1.5 (and other non-integer multipliers) can land on a
        // fractional second — the Lua bridge's TIME_FACTOR dispatch only
        // matches whole seconds (%d+), so round before it ever leaves here.
        finalSeconds = Math.round(seconds * bonus.value);
      }

      return {
        value: finalSeconds,
        speedValue,
        // reel lands on the base duration roll with the bonus called
        // out inline, same as Immortality's own seconds reel
        label: bonus ? `${seconds}s (${bonus.label} bonus)` : `${seconds}s`,
        icon: null,
        bonus: bonus ? { key: bonus.key, label: bonus.label, type: bonus.type } : null,
        fullLabel: `x${speedValue} for ${finalSeconds}s`,
      };
    }

    case 'alcohol': {
      const base = round2(randFloat(def.min ?? 0.05, def.max ?? 0.2));
      const bonus = rollWeightedBonus(def.bonuses, forceBonus);
      const finalValue = bonus && bonus.type === 'multiply' ? round2(base * bonus.value) : base;
      const basePercent = Math.round(base * 100);
      const finalPercent = Math.round(finalValue * 100);

      return {
        value: finalValue,
        label: bonus ? `${basePercent}% (${bonus.label} bonus)` : `${basePercent}%`,
        icon: null,
        bonus: bonus ? { key: bonus.key, label: bonus.label, type: bonus.type } : null,
        fullLabel: `${finalPercent}%`,
      };
    }

    case 'junk-item': {
      const items = Array.isArray(def.items) ? def.items : [];

      if (items.length === 0) {
        return null;
      }

      const item = items[Math.floor(Math.random() * items.length)];
      const count = Number.isFinite(item.count) ? item.count : 1;

      return {
        value: item.id,
        count,
        label: item.label,
        icon: item.icon || null,
        fullLabel: count > 1 ? `${item.label} x${count}` : item.label,
      };
    }

    default:
      return null;
  }
}

/*
 * Spinning filler for slot 2's overlay reel — same idea as
 * positive-effects.cjs's perkValuePool.
 */
function effectValuePool(key) {
  const def = effectDef(key);

  if (!def || !hasValueRoll(def)) {
    return [];
  }

  switch (key) {
    case 'break-item': {
      const filler = Array.isArray(def.fillerNumbers) ? def.fillerNumbers : [];
      const numbers = [...new Set([def.min, def.max, ...filler])];

      return numbers.map((n) => ({ label: `-${n}%`, icon: null }));
    }

    case 'time-factor': {
      const filler = Array.isArray(def.fillerNumbers) ? def.fillerNumbers : [];
      const numbers = [...new Set([def.min, def.max, ...filler])];

      return numbers.map((n) => ({ label: `${n}s`, icon: null }));
    }

    case 'alcohol': {
      const min = Number.isFinite(def.min) ? def.min : 0.05;
      const max = Number.isFinite(def.max) ? def.max : 0.2;

      return [
        { label: `${Math.round(min * 100)}%`, icon: null },
        { label: `${Math.round(max * 100)}%`, icon: null },
      ];
    }

    case 'junk-item': {
      const items = Array.isArray(def.items) ? def.items : [];

      return items.map((item) => ({
        label: Number.isFinite(item.count) ? `${item.label} x${item.count}` : item.label,
        icon: item.icon || null,
      }));
    }

    default:
      return [];
  }
}

/*
 * Turn a rolled effect + its rolled value into gamma-bridge command
 * lines — see GAMMA MOD/gamedata/scripts/zzzzzz_slot_machine_bridge.script
 * for the matching line handlers.
 */
function negativeEffectCommandLines(effect, effectValue, user) {
  if (!effect) {
    return [];
  }

  const who = (typeof user === 'string' && user.trim()) || 'Someone';
  const resultLabel = effectValue ? ` (${effectValue.fullLabel || effectValue.label})` : '';
  const lines = [`MSG|perk|${who} - ${effect.label}${resultLabel}`];

  switch (effect.key) {
    case 'drop-weapon':
      lines.push('DROP_WEAPON');
      break;

    case 'empty-pockets':
      lines.push('EMPTY_POCKETS');
      break;

    case 'break-item':
      if (effectValue) {
        lines.push(`BREAK_ITEM|${effectValue.value}`);
      }

      break;

    case 'time-factor':
      if (effectValue) {
        lines.push(`TIME_FACTOR|${effectValue.speedValue}|${effectValue.value}`);
      }

      break;

    case 'alcohol':
      if (effectValue) {
        lines.push(`ALCOHOL|${effectValue.value}`);
      }

      break;

    case 'junk-item':
      if (effectValue) {
        lines.push(`GIVE_JUNK|${effectValue.value}|${effectValue.count}`);
      }

      break;

    default:
      break;
  }

  return lines;
}

module.exports = {
  listEffects,
  isEffectEnabled,
  setEffectEnabled,
  setEffectChance,
  resetEffects,
  rollNegativeEffect,
  rollEffectValue,
  effectValuePool,
  negativeEffectCommandLines,
};
