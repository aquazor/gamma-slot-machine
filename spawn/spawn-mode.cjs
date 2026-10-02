/*
 * ---------------------------------------------------------
 * DUAL-SLOT SPAWN MODE FACTORY
 * ---------------------------------------------------------
 * Always picks exactly ONE group, then rolls its count once. Count uses
 * its own range rule (see countRange below): no min/max given at all ->
 * exact `count`, not an invented range.
 *
 * On top of that, each roll has a chance of ONE bonus applying (defined
 * per category+tier in the data file's `_bonuses`, never hardcoded here):
 * a count multiplier/addition, or a forced "upgrade" to a rarer group
 * from an explicit pool. At most one bonus per roll.
 *
 * Bonuses can be enabled/disabled from Settings (by `key`, applies across
 * every tier that defines that key) — state is PER INSTANCE (createSpawnMode
 * call), so e.g. the normal roster and the labs roster can have their bonus
 * chances tuned independently, even though the bonus keys (double-count,
 * plus-two, rare-upgrade) are the same names in both. Faction on/off
 * toggles are a different story: those live in enemy-pool.cjs's
 * module-level `factionToggles`, shared across every instance on
 * purpose — a faction key means the same real-world squad everywhere.
 *
 * `createSpawnMode({ data, overridesFile })`:
 *   data          the parsed <name>.data.json roster
 *   overridesFile filename (under ~/.gamma-slot-machine/) for this
 *                 instance's own persisted bonus-chance overrides
 */

const { createEnemyPool } = require('./enemy-pool.cjs');
const { randBelow } = require('../utils/random.cjs');
const { rollWeightedBonus } = require('../utils/weighted.cjs');
const { createKeyToggles } = require('../utils/key-toggles.cjs');
const { createChanceOverrides } = require('../utils/chance-overrides.cjs');

/*
 * Human-readable blurb per bonus key, for the Settings toggle list — the
 * short `label` from the data (e.g. "x2") is what shows on the overlay
 * itself, it's too terse for a standalone settings row. Shared across
 * every instance: these are the only bonus types that exist, regardless
 * of which roster defines them.
 */
const BONUS_DESCRIPTIONS = {
  'double-count': 'Doubles the spawn count',
  'plus-one': 'Adds +1 to the spawn count',
  'plus-two': 'Adds +2 to the spawn count',
  'rare-upgrade': 'Upgrades the the tier of a roll',
};

function createSpawnMode({ data, overridesFile }) {
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

  const bonusToggles = createKeyToggles();
  const { isEnabled: isBonusEnabled, setEnabled: setBonusEnabled } = bonusToggles;

  /*
   * Chance overrides, by key — editing a bonus's chance in Settings
   * changes it across every tier (in THIS instance) that defines that
   * key. Persisted to disk (same override-file pattern positive-effects.cjs
   * uses for its own chance overrides) so a streamer's tuning survives a
   * server restart — unlike the enable/disable toggle above, which is a
   * live on/off switch and deliberately stays runtime-only.
   */
  const chanceOverrides = createChanceOverrides(overridesFile);

  function effectiveChance(bonus) {
    const override = chanceOverrides.get(bonus.key);

    return override !== undefined ? override : bonus.chance;
  }

  const setBonusChance = chanceOverrides.set;

  /*
   * "Restore defaults" for the whole section: re-enables every bonus and
   * wipes every persisted chance override, so listBonuses() falls straight
   * back to whatever's baked into this instance's data file.
   */
  function resetBonuses() {
    bonusToggles.enableAll();
    chanceOverrides.clear();
  }

  /*
   * Every distinct bonus key across every tier/category, with a label
   * (first definition found) and current enabled state — for the
   * Settings UI. Global toggles (within this instance), not per-tier: a
   * key found in multiple tiers is still just one row.
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
   *   disabled or set to 0% — nothing to guarantee or draw from. The
   *   math itself lives in utils/weighted.cjs's rollWeightedBonus.
   */
  function rollBonus(category, tier, forceGuaranteed) {
    const enabled = bonusesFor(category, tier)
      .filter((b) => isBonusEnabled(b.key))
      .map((b) => ({ ...b, chance: effectiveChance(b) }));

    return rollWeightedBonus(enabled, forceGuaranteed);
  }

  /*
   * No min/max given at all -> exact `count`, no invented range. A range
   * only exists here if the data explicitly sets min and/or max (the
   * missing bound then falls back to `count`).
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
   * A faction that exists ONLY in the Expert tier of THIS instance's data
   * (e.g. Monolith/Sin/UNISG in the normal roster) — deliberately gated
   * there. `fromTier` upgrades reach into a higher tier's roster on
   * purpose, but must not use that as a backdoor around the gate: rolling
   * on Basic/Advanced should never be able to produce one of these, even
   * via an Expert-sourced upgrade. Mutants have no such gate, so this
   * only applies to 'enemies'. An instance whose data has the faction at
   * every tier (e.g. the labs roster) never matches this, so the gate is
   * a no-op there — exactly right, since it isn't Expert-only for labs.
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
   * Returns {category, tier, group, label, icon, sections, count, text}
   * plus a `bonus` field (null, or {key,label,type}) — so
   * spawnCommandLines() and the overlay's rendering both work unchanged.
   *
   * Returns null if the category/tier has no usable groups.
   */
  function rollDualSlot(category, tier, forceBonus = false) {
    const groups = pool.enabledGroupsFor(category, tier);
    let keys = Object.keys(groups);

    if (keys.length === 0) {
      return null;
    }

    let key = keys[randBelow(keys.length)];
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
        key = upgradeKeys[randBelow(upgradeKeys.length)];
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

    const baseCount = range.min + randBelow(range.max - range.min + 1);
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

  return {
    ...pool,
    rollDualSlot,
    listBonuses,
    isBonusEnabled,
    setBonusEnabled,
    setBonusChance,
    resetBonuses,
  };
}

module.exports = { createSpawnMode };
