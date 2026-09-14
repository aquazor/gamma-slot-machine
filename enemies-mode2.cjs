/*
 * ---------------------------------------------------------
 * MODE 2 — dual-slot spawn (count reel + species reel)
 * ---------------------------------------------------------
 * Unlike mode 1's rollSpawn (N independent group picks, `rolls` = how
 * many), mode 2 always picks exactly ONE group, then rolls its count
 * once — `rolls` from the triggering event/reward is ignored entirely
 * here. Count uses its OWN range rule (see countRange below),
 * deliberately different from mode 1's rangeForGroup: no min/max at
 * all -> exact `count`, not an invented range.
 *
 * On top of that, each roll has a chance of ONE bonus applying (defined
 * per category+tier in enemies.mode2.data.json's `_bonuses`, never
 * hardcoded here): a count multiplier/addition, or a forced "upgrade"
 * to a rarer group from an explicit pool. At most one bonus per roll.
 *
 * Bonuses can be globally enabled/disabled from Settings (by `key`,
 * applies across every tier that defines that key) — state here mirrors
 * enemy-pool.cjs's per-instance faction toggles: runtime-only, resets
 * on restart.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createEnemyPool, randInt, TIER_ORDER } = require('./enemy-pool.cjs');
const data = require('./enemies.mode2.data.json');

const pool = createEnemyPool(data);

/*
 * ---------------------------------------------------------
 * BONUS DEFINITIONS (read-only, from data) + ENABLE/DISABLE STATE
 * ---------------------------------------------------------
 */

function bonusesFor(category, tier) {
  const cat = data[category] || {};
  const tierData = cat[tier] || {};

  return Array.isArray(tierData._bonuses) ? tierData._bonuses : [];
}

const disabledBonusKeys = new Set();

function isBonusEnabled(key) {
  return !disabledBonusKeys.has(key);
}

function setBonusEnabled(key, enabled) {
  if (enabled) {
    disabledBonusKeys.delete(key);
  } else {
    disabledBonusKeys.add(key);
  }
}

/*
 * Chance overrides, by key — same "global by key" model as the enable
 * toggle above: editing a bonus's chance in Settings changes it across
 * every tier that defines that key, not just one. Persisted to disk
 * (same override-file pattern as bits-rewards.cjs's thresholds) so a
 * streamer's tuning survives a server restart — unlike the enable/
 * disable toggle above, which is a live on/off switch and deliberately
 * stays runtime-only.
 */
const CHANCE_OVERRIDES_PATH = path.join(
  os.homedir(),
  '.gamma-slot-machine',
  'bonus-chance-overrides.json',
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

function effectiveChance(bonus) {
  const overrides = loadChanceOverrides();
  const override = overrides[bonus.key];

  return typeof override === 'number' ? override : bonus.chance;
}

function setBonusChance(key, chance) {
  const clamped = Math.max(0, Math.min(1, Number(chance) || 0));

  const overrides = loadChanceOverrides();

  overrides[key] = clamped;
  saveChanceOverrides(overrides);
}

/*
 * Human-readable blurb per bonus key, for the Settings toggle list —
 * the short `label` from the data (e.g. "x2") is what shows on the
 * overlay itself, it's too terse for a standalone settings row.
 */
const BONUS_DESCRIPTIONS = {
  'double-count': 'Doubles the spawn count',
  'plus-two': 'Adds +2 to the spawn count',
  'rare-upgrade': 'Upgrades the the tier of a roll',
};

/*
 * Every distinct bonus key across every tier/category, with a label
 * (first definition found) and current enabled state — for the
 * Settings UI. Global toggles, not per-tier: a key found in multiple
 * tiers is still just one row.
 */
function listBonuses() {
  const seen = new Map(); // key -> first-seen bonus def (for label/chance)

  for (const category of pool.CATEGORIES) {
    for (const tier of pool.tiersFor(category)) {
      for (const bonus of bonusesFor(category, tier)) {
        if (!seen.has(bonus.key)) {
          seen.set(bonus.key, bonus);
        }
      }
    }
  }

  return [...seen.entries()].map(([key, bonus]) => ({
    key,
    label: bonus.label || key,
    description: BONUS_DESCRIPTIONS[key] || '',
    enabled: isBonusEnabled(key),
    chance: effectiveChance(bonus),
  }));
}

/*
 * Pick at most one bonus from this tier's list. Chances are editable
 * from Settings (see setBonusChance above), so this has to stay sane
 * no matter what gets typed in there — including a total over 100%.
 *
 *   forceGuaranteed = false (normal roll) AND the enabled chances add
 *   up to under 100%: chance of no bonus at all is 1 - that total.
 *   Walks the list in order, each bonus claiming its own slice of
 *   [0,1) — so at most one can match.
 *
 *   forceGuaranteed = true (multi-sub gift bomb) OR the enabled chances
 *   already add up to 100%+ (no room left for "no bonus" anyway): a
 *   bonus ALWAYS applies, drawn proportionally to each one's own share
 *   of the total — so e.g. three bonuses all set to 100% still split
 *   evenly (~33% each) instead of the first one in the list winning
 *   every single time. Falls back to null only if every bonus is
 *   disabled — nothing to guarantee or draw from.
 */
function rollBonus(category, tier, forceGuaranteed) {
  const enabled = bonusesFor(category, tier)
    .filter((b) => isBonusEnabled(b.key))
    .map((b) => ({ ...b, chance: effectiveChance(b) }));

  if (enabled.length === 0) {
    return null;
  }

  const total = enabled.reduce((sum, b) => sum + b.chance, 0);

  if (forceGuaranteed || total >= 1) {
    let roll = Math.random() * total;

    for (const bonus of enabled) {
      if (roll < bonus.chance) {
        return bonus;
      }

      roll -= bonus.chance;
    }

    return enabled[enabled.length - 1]; // float-rounding fallback
  }

  let roll = Math.random();

  for (const bonus of enabled) {
    if (roll < bonus.chance) {
      return bonus;
    }

    roll -= bonus.chance;
  }

  return null;
}

/*
 * Mode 2's own count-range rule — deliberately NOT mode 1's
 * rangeForGroup. No min/max given at all -> exact `count`, no invented
 * range. A range only exists here if the data explicitly sets min
 * and/or max (the missing bound then falls back to `count`, same
 * clamping mode 1 uses once a range is actually in play).
 */
function countRange(group, base) {
  const min = Number.isFinite(group.min) ? Math.max(1, Math.floor(group.min)) : null;
  const max = Number.isFinite(group.max) ? Math.max(1, Math.floor(group.max)) : null;

  if (min === null && max === null) {
    return { min: base, max: base };
  }

  let lo = min !== null ? min : Math.min(max, base);
  let hi = max !== null ? max : Math.max(min, base);

  if (lo > hi) {
    [lo, hi] = [hi, lo];
  }

  return { min: lo, max: hi };
}

/*
 * The tier one step harder than `tier` (Basic -> Advanced -> Expert),
 * or null if `tier` is already the top of the category's tier list —
 * where a `rare-upgrade` pool's keys get looked up. Expert has no tier
 * above it, so its own pool resolves against its own roster instead.
 */
function tierAbove(category, tier) {
  const tiers = pool.tiersFor(category);
  const idx = tiers.indexOf(tier);

  return idx >= 0 && idx < tiers.length - 1 ? tiers[idx + 1] : null;
}

/*
 * A faction that exists ONLY in the Expert tier (Monolith/Sin/UNISG) —
 * deliberately gated there. `fromTier` upgrades reach into a higher
 * tier's roster on purpose, but must not use that as a backdoor around
 * the gate: rolling on Basic/Advanced should never be able to produce
 * one of these, even via an Expert-sourced upgrade. Mutants have no
 * such gate, so this only applies to 'enemies'.
 */
function isExpertOnlyFaction(key) {
  const tiers = pool
    .tiersFor('enemies')
    .filter((t) => Boolean(pool.groupsFor('enemies', t)[key]));

  return tiers.length === 1 && tiers[0] === 'Expert';
}

/*
 * ---------------------------------------------------------
 * THE ROLL
 * ---------------------------------------------------------
 * Returns the same per-result shape mode 1's rollSpawn entries use
 * (category/tier/group/label/icon/sections/count/text) plus a `bonus`
 * field (null, or {key,label,type}) — so spawnCommandLines() and the
 * overlay's existing rendering both work unchanged. `rolls` from the
 * caller is intentionally NOT used for the count here (see file header)
 * — only `forceBonus` (a multi-sub gift bomb) matters.
 *
 * Returns null if the category/tier has no usable groups.
 */
function rollDualSlot(category, tier, forceBonus = false) {
  const groups = pool.enabledGroupsFor(category, tier);
  let keys = Object.keys(groups);

  if (keys.length === 0) {
    return null;
  }

  let key = keys[randInt(keys.length)];
  let group = groups[key];

  const bonus = rollBonus(category, tier, forceBonus);

  if (bonus && bonus.type === 'upgrade') {
    // `pool`: an explicit, hand-picked list of group keys — resolved
    // against the tier one step harder than this roll's own tier (so a
    // Basic roll's pool can name "burers" even though Basic itself has
    // no burers — it's looked up in Advanced's roster). A tier with
    // nothing harder above it (Expert) resolves its pool against its
    // own roster instead, same as before.
    // Regardless of where it's sourced from: never let this be a
    // backdoor around the Expert-only faction gate (Monolith/Sin/UNISG)
    // when the roll itself isn't already at Expert — see
    // isExpertOnlyFaction.
    const sourceTier = tierAbove(category, tier) || tier;
    const sourceRoster = pool.enabledGroupsFor(category, sourceTier);

    let sourceGroups = Object.fromEntries(
      (bonus.pool || []).filter((k) => sourceRoster[k]).map((k) => [k, sourceRoster[k]]),
    );

    if (category === 'enemies' && tier !== 'Expert') {
      sourceGroups = Object.fromEntries(
        Object.entries(sourceGroups).filter(([k]) => !isExpertOnlyFaction(k)),
      );
    }

    const upgradeKeys = Object.keys(sourceGroups);

    if (upgradeKeys.length > 0) {
      key = upgradeKeys[randInt(upgradeKeys.length)];
      group = sourceGroups[key];
    }
  }

  const sections = Array.isArray(group.sections)
    ? group.sections.filter((section) => typeof section === 'string' && section.trim())
    : [];

  if (sections.length === 0) {
    return null;
  }

  const base = Math.max(1, Number(group.count) || 1);
  const range = countRange(group, base);

  const baseCount = range.min + randInt(range.max - range.min + 1);
  let count = baseCount;
  let bonusApplied = null;

  if (bonus && bonus.type === 'multiply') {
    count *= bonus.value;
    bonusApplied = bonus;
  } else if (bonus && bonus.type === 'add') {
    count += bonus.value;
    bonusApplied = bonus;
  } else if (bonus && bonus.type === 'upgrade') {
    bonusApplied = bonus;
  }

  const label = group.label || key;

  return {
    category,
    tier,
    group: key,
    label,
    icon: group.icon || null,
    sections,
    count,
    // The count roll before any multiply/add bonus — the count reel
    // lands on this (with the bonus called out separately), the
    // combined `text` below is what actually spawns.
    baseCount,
    bonus: bonusApplied
      ? { key: bonusApplied.key, label: bonusApplied.label, type: bonusApplied.type }
      : null,
    // "Tier upgrade" reads better than "(RARE bonus)" for the upgrade
    // type specifically — the banner/settings still call it "RARE",
    // this is just the result line under the reel.
    text: bonusApplied
      ? bonusApplied.type === 'upgrade'
        ? `${label.toUpperCase()} x${count} (Tier upgrade)`
        : `${label.toUpperCase()} x${count} (${bonusApplied.label} bonus)`
      : `${label.toUpperCase()} x${count}`,
  };
}

module.exports = {
  ...pool,
  rollDualSlot,
  listBonuses,
  isBonusEnabled,
  setBonusEnabled,
  setBonusChance,
};
