/*
 * ---------------------------------------------------------
 * ENEMY POOL FACTORY
 * ---------------------------------------------------------
 * Parameterized by a data object (enemies-mode2.cjs binds it to
 * enemies.mode2.data.json) so the roster logic (groups, tiers, sections,
 * counts) isn't hardcoded to one data file.
 *
 * Data shape: <category> -> <tier> -> <group> -> { label, sections,
 * count, min, max, icon }. A leading underscore on a key (e.g.
 * `_bonuses`) marks it as metadata, not a spawn group — filtered out
 * everywhere groups are enumerated.
 */

const { createKeyToggles } = require('../utils/key-toggles.cjs');

const CATEGORIES = ['mutants', 'enemies'];
const TIER_ORDER = ['Basic', 'Advanced', 'Expert'];

/*
 * Which squads (enemies-category factions) are turned off — runtime-only,
 * like preset/spawnTier, resets on server restart.
 */
const factionToggles = createKeyToggles();

function createEnemyPool(data) {
  function isCategory(name) {
    return CATEGORIES.includes(name);
  }

  /*
   * Tiers that actually have data for a category (in Basic..Expert order).
   * Falls back to every tier key present if none match the known order.
   */
  function tiersFor(category) {
    const cat = data[category] || {};
    const known = TIER_ORDER.filter((tier) => cat[tier] && Object.keys(cat[tier]).length > 0);

    return known.length > 0 ? known : Object.keys(cat);
  }

  /*
   * Union of tiers across both categories — for the settings selector.
   */
  function spawnTiers() {
    const seen = new Set();

    for (const category of CATEGORIES) {
      for (const tier of tiersFor(category)) {
        seen.add(tier);
      }
    }

    const ordered = TIER_ORDER.filter((tier) => seen.has(tier));

    return ordered.length > 0 ? ordered : [...seen];
  }

  // Spawn groups only — underscore-prefixed keys (metadata like
  // `_bonuses`) are never real groups and are filtered out here so
  // every caller downstream is automatically safe.
  function groupsFor(category, tier) {
    const cat = data[category] || {};
    const raw = cat[tier] || {};
    const filtered = {};

    for (const key of Object.keys(raw)) {
      if (!key.startsWith('_')) {
        filtered[key] = raw[key];
      }
    }

    return filtered;
  }

  /*
   * ---------------------------------------------------------
   * ENEMY FACTION TOGGLES
   * ---------------------------------------------------------
   * Streamers pick which armed factions they want spawnable at all
   * (e.g. never Duty, if that clashes with their playthrough) — this
   * is a blanket on/off per faction key, the SAME across every tier
   * (a faction disabled in Basic is also off in Advanced/Expert), unlike
   * mutants where inclusion is just baked into the data file per tier.
   *
   * Only applies to the 'enemies' category; mutants are unaffected.
   */

  function factionKeys() {
    const seen = new Set();
    const ordered = [];

    for (const tier of tiersFor('enemies')) {
      for (const key of Object.keys(groupsFor('enemies', tier))) {
        if (!seen.has(key)) {
          seen.add(key);
          ordered.push(key);
        }
      }
    }

    return ordered;
  }

  function factionDef(key) {
    for (const tier of tiersFor('enemies')) {
      const def = groupsFor('enemies', tier)[key];

      if (def) {
        return def;
      }
    }

    return null;
  }

  function isFactionEnabled(key) {
    return factionToggles.isEnabled(key);
  }

  function setFactionEnabled(key, enabled) {
    factionToggles.setEnabled(key, enabled);
  }

  /*
   * Which tiers actually define this faction key (e.g. a faction only
   * added to Expert has no Basic/Advanced entries).
   */
  function tiersForFaction(key) {
    return tiersFor('enemies').filter((tier) => Boolean(groupsFor('enemies', tier)[key]));
  }

  /*
   * Snapshot for the settings UI: every faction key with its label/icon
   * (pulled from whichever tier defines it first), current enabled state,
   * and whether it's Expert-only (so the UI can flag it) rather than
   * hardcoding which factions that is — stays correct if the tier
   * composition changes later.
   */
  function listFactions() {
    return factionKeys().map((key) => {
      const def = factionDef(key);
      const tiers = tiersForFaction(key);

      return {
        key,
        label: (def && def.label) || key,
        icon: (def && def.icon) || null,
        enabled: isFactionEnabled(key),
        expertOnly: tiers.length === 1 && tiers[0] === 'Expert',
      };
    });
  }

  /*
   * groupsFor filtered down to enabled factions (category 'enemies' only —
   * mutants pass through unchanged). Used wherever a roll or the overlay
   * filler actually needs to pick from the pool.
   */
  function enabledGroupsFor(category, tier) {
    const groups = groupsFor(category, tier);

    if (category !== 'enemies') {
      return groups;
    }

    const filtered = {};

    for (const [key, def] of Object.entries(groups)) {
      if (isFactionEnabled(key)) {
        filtered[key] = def;
      }
    }

    return filtered;
  }

  /*
   * Every group's display label for a category + tier — the overlay
   * uses this as the spinning filler for the spawn reel.
   */
  function groupOptions(category, tier) {
    const groups = enabledGroupsFor(category, tier);

    return Object.keys(groups).map((key) => ({
      label: groups[key].label || key,
      icon: groups[key].icon || null,
    }));
  }

  /*
   * Turn one or more rolled spawns into command.txt lines: a single
   * MSG|spawn|... summary line (red in-game) plus one SPAWN|...|count
   * line per rolled group.
   */
  function spawnCommandLines(rolls, user) {
    const list = (Array.isArray(rolls) ? rolls : [rolls]).filter(
      (roll) => roll && roll.sections && roll.sections.length > 0,
    );

    if (list.length === 0) {
      return [];
    }

    const who = (typeof user === 'string' && user.trim()) || 'Someone';
    const summary = list.map((roll) => `${roll.label} x${roll.count}`).join(', ');

    return [
      `MSG|spawn|${who} - ${summary}`,
      ...list.map((roll) => `SPAWN|${roll.sections.join(';')}|${roll.count}`),
    ];
  }

  return {
    CATEGORIES,
    isCategory,
    tiersFor,
    spawnTiers,
    groupsFor,
    enabledGroupsFor,
    groupOptions,
    spawnCommandLines,
    listFactions,
    isFactionEnabled,
    setFactionEnabled,
  };
}

module.exports = { createEnemyPool, CATEGORIES, TIER_ORDER };
