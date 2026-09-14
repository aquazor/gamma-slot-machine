/*
 * ---------------------------------------------------------
 * PERKS  (Immortality / Give Ammo / Give Money / Medicine)
 * ---------------------------------------------------------
 * A fourth roll outcome alongside loot/squads/mutants — dual-slot, same
 * shape as Count Roll's count+species mechanic:
 *
 *   slot 1: WHICH perk (equal odds among enabled ones)
 *   slot 2: that perk's own VALUE — a duration/pack-count rolled from
 *           a min/max range, a fixed money amount picked from a list, or
 *           a random medical item. See rollPerkValue() / perkValuePool().
 *
 * Perks are flat and tier-less (no Basic/Advanced/Expert split) — the
 * definitions live in positive-effects.data.json, this module rolls
 * among them and turns the winner into gamma-bridge command lines.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function randInt(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);

  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function formatMoney(amount) {
  return String(Number(amount));
}

/*
 * Pick at most one bonus from a `bonuses` list — same rules as Count
 * Roll's own spawn bonuses (enemies-mode2.cjs's rollBonus): each entry
 * claims its own slice of chance; if the enabled ones add up to under
 * 100%, the leftover is "no bonus"; at/above 100%, a bonus is always
 * drawn, split proportionally by relative chance rather than the first
 * one in the list always winning. Returns the winning bonus def, or null.
 *
 * `forceGuaranteed` (bits power-ups) skips the "no bonus" slice entirely,
 * same as enemies-mode2.cjs's own forceGuaranteed — a bonus always lands,
 * still drawn proportionally by relative chance among the list.
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

const data = require('./positive-effects.data.json');

function perkKeys() {
  return Object.keys(data).filter((key) => !key.startsWith('_'));
}

function perkDef(key) {
  return data[key] || null;
}

/*
 * Enable/disable toggles, same "global by key" runtime-only model as
 * enemy-pool.cjs's faction toggles and enemies-mode2.cjs's bonus toggles —
 * resets on restart.
 */
const disabledPerkKeys = new Set();

function isPerkEnabled(key) {
  return !disabledPerkKeys.has(key);
}

function setPerkEnabled(key, enabled) {
  if (enabled) {
    disabledPerkKeys.delete(key);
  } else {
    disabledPerkKeys.add(key);
  }
}

/*
 * Chance overrides, by key — same "global by key" model as the enable
 * toggle above, and the same override-file pattern enemies-mode2.cjs uses
 * for its own spawn-bonus chances: editing a perk's roll weight in
 * Settings persists to disk so it survives a server restart, without
 * ever touching positive-effects.data.json itself.
 */
const CHANCE_OVERRIDES_PATH = path.join(
  os.homedir(),
  '.gamma-slot-machine',
  'perk-chance-overrides.json',
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

function effectivePerkChance(key, def) {
  const overrides = loadChanceOverrides();
  const override = overrides[key];
  const fallback = def && Number.isFinite(def.chance) ? def.chance : 1;

  return typeof override === 'number' ? override : fallback;
}

function setPerkChance(key, chance) {
  const clamped = Math.max(0, Math.min(1, Number(chance) || 0));

  const overrides = loadChanceOverrides();

  overrides[key] = clamped;
  saveChanceOverrides(overrides);
}

/*
 * "Restore defaults" for the whole section: re-enables every perk and
 * wipes every persisted chance override, so listPerks() falls straight
 * back to whatever's baked into positive-effects.data.json.
 */
function resetPerks() {
  disabledPerkKeys.clear();
  saveChanceOverrides({});
}

const PERK_DESCRIPTIONS = {
  immortality: 'Temporary invulnerability',
  'give-ammo': 'A few ammo packs for whatever\'s in hand',
  'give-money': 'A cash drop',
  medicine: 'A medical item plus a secondary supply item',
};

/*
 * Snapshot for the Settings UI: every perk with its label/description,
 * relative roll weight, and current enabled state.
 */
function listPerks() {
  return perkKeys().map((key) => {
    const def = perkDef(key);

    return {
      key,
      label: (def && def.label) || key,
      description: PERK_DESCRIPTIONS[key] || '',
      icon: (def && def.icon) || null,
      chance: effectivePerkChance(key, def),
      enabled: isPerkEnabled(key),
    };
  });
}

/*
 * Pick one enabled perk — weighted by each perk's own `chance` (relative
 * weight, not required to add up to 1; a perk with no `chance` set just
 * weighs 1, same as everyone else). Disabling a perk removes it entirely
 * and its share is redistributed proportionally among what's left, same
 * mechanism as the count-roll spawn bonuses' guaranteed-draw. Returns
 * null if every perk is disabled.
 */
function rollPerk() {
  const enabledKeys = perkKeys().filter((key) => isPerkEnabled(key));

  if (enabledKeys.length === 0) {
    return null;
  }

  const weights = enabledKeys.map((key) => Math.max(0, effectivePerkChance(key, perkDef(key))));

  const total = weights.reduce((sum, w) => sum + w, 0);

  let key;

  if (total <= 0) {
    // every weight zero/invalid — fall back to a plain uniform pick
    // rather than never rolling anything
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

  const def = perkDef(key);
  const label = (def && def.label) || key;

  return { key, label, icon: (def && def.icon) || null, def };
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function isValidCombo(combo) {
  return (
    combo &&
    Array.isArray(combo.primary) &&
    combo.primary.length > 0 &&
    Array.isArray(combo.secondary) &&
    combo.secondary.length > 0
  );
}

/*
 * Medicine's own primary/secondary item lists, keyed by spawn tier
 * (Basic/Advanced/Expert — same tier the streamer already picks for
 * squads/mutants). A roll picks ONE random `primary` item (what the reel
 * lands on) plus ONE random `secondary` item (always given alongside it —
 * a single-entry `secondary` list means that item is simply guaranteed
 * every time, same mechanism as a multi-entry one, just with nothing else
 * it could roll). Falls back to whichever tier IS fully defined if the
 * requested one isn't (defensive only), so a roll never comes up empty
 * just because of a tier mismatch.
 */
function medicineComboForTier(def, tier) {
  const byTier = def.items && !Array.isArray(def.items) ? def.items : {};

  if (isValidCombo(byTier[tier])) {
    return byTier[tier];
  }

  const fallbackTier = Object.keys(byTier).find((t) => isValidCombo(byTier[t]));

  return fallbackTier ? byTier[fallbackTier] : { primary: [], secondary: [] };
}

/*
 * Medicine's own small chance of an extra bonus item on top of the
 * regular roll — tier-independent, drawn from `def.bonus.items`. Returns
 * { id, label } or null (no bonus, the common case). `forceGuaranteed`
 * (bits power-ups) treats the chance as 100% instead of `def.bonus.chance`.
 */
function rollMedicineBonus(def, forceGuaranteed) {
  const bonusDef = def.bonus;
  const chance = forceGuaranteed
    ? 1
    : bonusDef && Number.isFinite(bonusDef.chance)
      ? bonusDef.chance
      : 0;
  const bonusItems = bonusDef && Array.isArray(bonusDef.items) ? bonusDef.items : [];

  if (bonusItems.length === 0 || Math.random() >= chance) {
    return null;
  }

  const item = bonusItems[Math.floor(Math.random() * bonusItems.length)];

  return { id: item.id, label: item.label || item.id };
}

/*
 * Roll perk-type-specific "slot 2" — the actual amount/item this
 * particular roll landed on. Returns { value, label, icon } or null.
 *   immortality / give-ammo: value = an integer within [min, max]
 *   give-money:              value = one of the fixed `amounts`
 *   medicine:                value = the rolled `primary` item's `id`
 *                             (what the reel itself lands on) — the
 *                             `secondary` item (and bonus, if any) ride
 *                             along and only show up in `fullLabel` /
 *                             `giveIds`, see medicineComboForTier
 *
 * `forceBonus` (bits power-ups) guarantees this perk's own bonus lands
 * instead of the normal per-roll chance — see rollWeightedBonus /
 * rollMedicineBonus.
 */
function rollPerkValue(key, tier, forceBonus) {
  const def = perkDef(key);

  if (!def) {
    return null;
  }

  switch (key) {
    case 'immortality': {
      const seconds = randInt(def.min, def.max);
      const bonus = rollWeightedBonus(def.bonuses, forceBonus);

      let finalSeconds = seconds;

      if (bonus && bonus.type === 'add') {
        finalSeconds = seconds + bonus.value;
      } else if (bonus && bonus.type === 'multiply') {
        finalSeconds = seconds * bonus.value;
      }

      return {
        value: finalSeconds,
        // reel lands on the base roll with the bonus called out inline,
        // same as Count Roll's own count reel ("x2 (+2 bonus)") — the
        // clean final total only shows in the result line below
        label: bonus ? `${seconds}s (${bonus.label} bonus)` : `${seconds}s`,
        icon: null,
        bonus: bonus ? { key: bonus.key, label: bonus.label, type: bonus.type } : null,
        fullLabel: `${finalSeconds}s`,
      };
    }

    case 'give-ammo': {
      const packs = randInt(def.min, def.max);
      const bonus = rollWeightedBonus(def.bonuses, forceBonus);

      let finalPacks = packs;

      if (bonus && bonus.type === 'add') {
        finalPacks = packs + bonus.value;
      } else if (bonus && bonus.type === 'multiply') {
        finalPacks = packs * bonus.value;
      }

      const packsWord = (n) => `${n} pack${n > 1 ? 's' : ''}`;

      return {
        value: finalPacks,
        // plain ASCII "x", not the Unicode "×" — the latter is a
        // multi-byte UTF-8 char that the game reads as raw CP1251 bytes
        // and renders as garbage ("Г—")
        label: bonus ? `x${packsWord(packs)} (${bonus.label} bonus)` : `x${packsWord(packs)}`,
        icon: null,
        bonus: bonus ? { key: bonus.key, label: bonus.label, type: bonus.type } : null,
        fullLabel: `x${packsWord(finalPacks)}`,
      };
    }

    case 'give-money': {
      const amounts = Array.isArray(def.amounts) ? def.amounts : [];

      if (amounts.length === 0) {
        return null;
      }

      const amount = amounts[Math.floor(Math.random() * amounts.length)];
      const bonus = rollWeightedBonus(def.bonuses, forceBonus);

      let finalAmount = amount;
      let bonusLabel = bonus ? bonus.label : null;

      if (bonus && bonus.type === 'multiply') {
        finalAmount = amount * bonus.value;
      } else if (bonus && bonus.type === 'add') {
        finalAmount = amount + bonus.value;
      } else if (bonus && bonus.type === 'add-random-amount') {
        const extra = amounts[Math.floor(Math.random() * amounts.length)];

        finalAmount = amount + extra;
        bonusLabel = `+${formatMoney(extra)}`;
      }

      return {
        value: finalAmount,
        label: bonus ? `${formatMoney(amount)} (${bonusLabel} bonus)` : formatMoney(amount),
        icon: null,
        bonus: bonus ? { key: bonus.key, label: bonusLabel, type: bonus.type } : null,
        fullLabel: formatMoney(finalAmount),
      };
    }

    case 'medicine': {
      const combo = medicineComboForTier(def, tier);

      if (combo.primary.length === 0 || combo.secondary.length === 0) {
        return null;
      }

      const primaryItem = pickRandom(combo.primary);
      const secondaryItem = pickRandom(combo.secondary);
      const label = primaryItem.label || primaryItem.id; // what the reel lands on
      const secondary = { id: secondaryItem.id, label: secondaryItem.label || secondaryItem.id };
      const bonus = rollMedicineBonus(def, forceBonus);

      const extras = [secondary.label];

      if (bonus) {
        extras.push(bonus.label);
      }

      return {
        value: primaryItem.id,
        label,
        icon: primaryItem.icon || null,
        secondary,
        bonus,
        // slot 2's result line — e.g. "AI-2 Medkit + Bandage" or, with a
        // bonus riding along, "AI-2 Medkit + Bandage + Antidote"
        fullLabel: `${label} + ${extras.join(' + ')}`,
        // every item id that actually needs to be given in-game
        giveIds: [primaryItem.id, secondary.id, ...(bonus ? [bonus.id] : [])],
      };
    }

    default:
      return null;
  }
}

/*
 * Spinning filler for slot 2's overlay reel — real possible outcomes plus
 * (for the numeric perks) a handful of `fillerNumbers` that are NEVER
 * actually landed on, purely there to pad the reel with variety. Medicine
 * has no filler concept — the current tier's own item list already
 * doubles as the pool, same as the species reel does for spawns.
 */
function perkValuePool(key, tier) {
  const def = perkDef(key);

  if (!def) {
    return [];
  }

  switch (key) {
    case 'immortality': {
      const filler = Array.isArray(def.fillerNumbers) ? def.fillerNumbers : [];
      const numbers = [...new Set([def.min, def.max, ...filler])];

      return numbers.map((n) => ({ label: `${n}s`, icon: null }));
    }

    case 'give-ammo': {
      const filler = Array.isArray(def.fillerNumbers) ? def.fillerNumbers : [];
      const numbers = [...new Set([def.min, def.max, ...filler])];

      return numbers.map((n) => ({ label: `x${n} pack${n > 1 ? 's' : ''}`, icon: null }));
    }

    case 'give-money': {
      const amounts = Array.isArray(def.amounts) ? def.amounts : [];
      const filler = Array.isArray(def.fillerNumbers) ? def.fillerNumbers : [];

      return [...amounts, ...filler].map((n) => ({ label: formatMoney(n), icon: null }));
    }

    case 'medicine': {
      const combo = medicineComboForTier(def, tier);
      const items = [...combo.primary, ...combo.secondary];

      return items.map((item) => ({ label: item.label || item.id, icon: item.icon || null }));
    }

    default:
      return [];
  }
}

/*
 * Turn a rolled perk + its rolled value into gamma-bridge command lines —
 * see mod/gamedata/scripts/slot_machine_bridge.script for the matching
 * GODMODE / MONEY / AMMO_MAGS / MEDKIT line handlers.
 */
function perkCommandLines(perk, perkValue, user) {
  if (!perk || !perkValue) {
    return [];
  }

  const who = (typeof user === 'string' && user.trim()) || 'Someone';
  const lines = [`MSG|perk|${who} - ${perk.label} (${perkValue.fullLabel || perkValue.label})`];

  switch (perk.key) {
    case 'immortality':
      lines.push(`GODMODE|${perkValue.value}`);
      break;

    case 'give-ammo':
      lines.push(`AMMO_MAGS|${perkValue.value}`);
      break;

    case 'give-money':
      lines.push(`MONEY|${perkValue.value}`);
      break;

    case 'medicine':
      for (const id of perkValue.giveIds || [perkValue.value]) {
        lines.push(`MEDKIT|${id}|1`);
      }

      break;

    default:
      break;
  }

  return lines;
}

module.exports = {
  listPerks,
  isPerkEnabled,
  setPerkEnabled,
  setPerkChance,
  resetPerks,
  rollPerk,
  rollPerkValue,
  perkValuePool,
  perkCommandLines,
};
