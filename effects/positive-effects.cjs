/*
 * ---------------------------------------------------------
 * PERKS  (Immortality / Give Ammo / Give Money / Medicine / Food & Water)
 * ---------------------------------------------------------
 * A fourth roll outcome alongside loot/squads/mutants — dual-slot, same
 * shape as Count Roll's count+species mechanic:
 *
 *   slot 1: WHICH perk (equal odds among enabled ones)
 *   slot 2: that perk's own VALUE — a duration/pack-count rolled from
 *           a min/max range, a fixed money amount picked from a list, a
 *           random medical item, or a random food+drink pair (shown as
 *           two icons, no text — see food-and-drinks.icon being a
 *           string[] rather than the usual single string/null). See
 *           rollPerkValue() / perkValuePool().
 *
 * Perks are flat and tier-less (no Basic/Advanced/Expert split) — the
 * definitions live in positive-effects.data.json, this module rolls
 * among them and turns the winner into gamma-bridge command lines.
 */

const { randInt, pick } = require('../utils/random.cjs');
const { rollWeightedBonus } = require('../utils/weighted.cjs');
const { createEffectCatalog } = require('../utils/effect-catalog.cjs');

function formatMoney(amount) {
  return String(Number(amount));
}

const data = require('./positive-effects.data.json');

// Roster, enable/disable toggles, chance overrides and the weighted pick
// itself live in the shared catalog (utils/effect-catalog.cjs) — this
// module only adds what's perk-specific on top.
const catalog = createEffectCatalog({ data, overridesFile: 'perk-chance-overrides.json' });

const {
  keys: perkKeys,
  def: perkDef,
  isEnabled: isPerkEnabled,
  setEnabled: setPerkEnabled,
  setChance: setPerkChance,
  reset: resetPerks,
} = catalog;

const PERK_DESCRIPTIONS = {
  immortality: 'Temporary invulnerability',
  'give-ammo': "A few ammo packs for whatever's in hand",
  'give-money': 'A cash drop',
  medicine: 'A medical item plus a secondary supply item',
  'food-and-drinks': 'A random meal plus a random drink',
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
      chance: catalog.chanceOf(key),
      enabled: isPerkEnabled(key),
    };
  });
}

/*
 * Pick one enabled perk — weighted by each perk's own `chance` (relative
 * weight, not required to add up to 1). Disabling a perk removes it
 * entirely and its share is redistributed proportionally among what's
 * left. Returns null if every perk is disabled.
 */
function rollPerk() {
  const key = catalog.rollKey();

  if (!key) {
    return null;
  }

  const def = perkDef(key);
  const label = (def && def.label) || key;

  return { key, label, icon: (def && def.icon) || null, def };
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

  const item = pick(bonusItems);

  return { id: item.id, label: item.label || item.id };
}

/*
 * Food & Water's own bonus is shaped differently from every other perk's:
 * instead of adding/multiplying a number or tacking on an extra item, it
 * just restricts BOTH rolls to a smaller "premium" subset of the same
 * food/drinks lists (`def.bonus.foodIds`/`drinkIds`) when it lands.
 * Returns { foods, drinks } — the pools to actually roll from — falling
 * back to the full lists whenever the bonus doesn't land or the def is
 * missing/empty. `forceGuaranteed` (bits power-ups) treats the chance as
 * 100% instead of `def.bonus.chance`.
 */
function foodDrinksPools(def, forceGuaranteed) {
  const foods = Array.isArray(def.food) ? def.food : [];
  const drinks = Array.isArray(def.drinks) ? def.drinks : [];

  const bonusDef = def.bonus;
  const chance = forceGuaranteed
    ? 1
    : bonusDef && Number.isFinite(bonusDef.chance)
      ? bonusDef.chance
      : 0;

  if (!bonusDef || Math.random() >= chance) {
    return { foods, drinks, bonusLanded: false };
  }

  const foodIds = new Set(Array.isArray(bonusDef.foodIds) ? bonusDef.foodIds : []);
  const drinkIds = new Set(Array.isArray(bonusDef.drinkIds) ? bonusDef.drinkIds : []);

  const premiumFoods = foods.filter((f) => foodIds.has(f.id));
  const premiumDrinks = drinks.filter((d) => drinkIds.has(d.id));

  return {
    foods: premiumFoods.length > 0 ? premiumFoods : foods,
    drinks: premiumDrinks.length > 0 ? premiumDrinks : drinks,
    bonusLanded: true,
  };
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

      const amount = pick(amounts);
      const bonus = rollWeightedBonus(def.bonuses, forceBonus);

      let finalAmount = amount;
      let bonusLabel = bonus ? bonus.label : null;

      if (bonus && bonus.type === 'multiply') {
        finalAmount = amount * bonus.value;
      } else if (bonus && bonus.type === 'add') {
        finalAmount = amount + bonus.value;
      } else if (bonus && bonus.type === 'add-random-amount') {
        const extra = pick(amounts);

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

      const primaryItem = pick(combo.primary);
      const secondaryItem = pick(combo.secondary);
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

    case 'food-and-drinks': {
      const { foods, drinks, bonusLanded } = foodDrinksPools(def, forceBonus);

      if (foods.length === 0 || drinks.length === 0) {
        return null;
      }

      const food = pick(foods);
      const drink = pick(drinks);

      return {
        value: `${food.id}|${drink.id}`,
        // no text label — the reel shows just the two icons side by side,
        // see Overlay.tsx's icon-pair rendering for a string[] `icon`
        label: '',
        icon: [food.icon || null, drink.icon || null],
        fullLabel: `${food.label || food.id} + ${drink.label || drink.id}`,
        giveIds: [food.id, drink.id],
        // plain "BONUS" badge like every other perk's — the specific
        // premium pair is already spelled out above, nothing extra to
        // call out in the badge label itself
        bonus: bonusLanded ? { key: 'food-and-drinks-premium', label: '', type: 'premium-pool' } : null,
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

    case 'food-and-drinks': {
      const foods = Array.isArray(def.food) ? def.food : [];
      const drinks = Array.isArray(def.drinks) ? def.drinks : [];
      const combos = [];

      for (const food of foods) {
        for (const drink of drinks) {
          combos.push({ label: '', icon: [food.icon || null, drink.icon || null] });
        }
      }

      return combos;
    }

    default:
      return [];
  }
}

/*
 * Turn a rolled perk + its rolled value into gamma-bridge command lines —
 * see GAMMA MOD/gamedata/scripts/zzzzzz_slot_machine_bridge.script for the matching
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

    case 'food-and-drinks':
      // MEDKIT's Lua handler just does alife_create_item(item_id, actor) —
      // works for any item section, not just medical ones, so it's reused
      // here rather than adding a dedicated command.
      for (const id of perkValue.giveIds || []) {
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
