/*
 * ---------------------------------------------------------
 * ENEMY POOL FACTORY
 * ---------------------------------------------------------
 * Everything enemies.cjs used to do, parameterized by a data object so
 * mode 1 (enemies.data.json) and mode 2 (enemies.mode2.data.json) can
 * share this logic without touching each other's state — each call to
 * createEnemyPool() gets its own view of the roster (groups, tiers,
 * sections, counts all come from that call's own `data`).
 *
 * Data shape: <category> -> <tier> -> <group> -> { label, sections,
 * count, min, max, icon }. A leading underscore on a key (e.g.
 * `_bonuses`, used by mode 2) marks it as metadata, not a spawn group —
 * filtered out everywhere groups are enumerated.
 */

const CATEGORIES = ['mutants', 'enemies'];
const TIER_ORDER = ['Basic', 'Advanced', 'Expert'];

/*
 * Which squads (enemies-category factions) are turned off — module-level
 * on purpose, NOT per-instance: a faction key (e.g. "duty") means the
 * same real-world squad regardless of which roll mode is active, so
 * disabling it in one mode must disable it in the other too. Both
 * enemies.cjs and enemies-mode2.cjs require this same module, and
 * Node's require cache makes them share this one Set. Runtime-only,
 * like preset/spawnTier — resets on server restart.
 */
const disabledFactions = new Set();

function randInt(max) {
  return Math.floor(Math.random() * max);
}

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
   * `disabledFactions` itself is shared across roll modes — see the
   * module-level comment above.
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
    return !disabledFactions.has(key);
  }

  function setFactionEnabled(key, enabled) {
    if (enabled) {
      disabledFactions.delete(key);
    } else {
      disabledFactions.add(key);
    }
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
  function groupLabels(category, tier) {
    const groups = enabledGroupsFor(category, tier);

    return Object.keys(groups).map((key) => groups[key].label || key);
  }

  /*
   * Same as groupLabels, but with the icon alongside — what the overlay's
   * spawn reel actually renders (icon + label per spinning row).
   */
  function groupOptions(category, tier) {
    const groups = enabledGroupsFor(category, tier);

    return Object.keys(groups).map((key) => ({
      label: groups[key].label || key,
      icon: groups[key].icon || null,
    }));
  }

  /*
   * A group's creature count for this roll.
   *
   *   rollsInBatch <= 1 (single-group reward): always `count`, exact.
   *
   *   rollsInBatch > 1 (multi-group "x3" reward): random within
   *   [min, max] — otherwise a "x3" reward would spawn 3x the pack size
   *   on top of rolling 3 packs (dogs count=2 -> 6 dogs from one
   *   redemption instead of a comparable ~3-5).
   *
   *   `min`/`max` are optional per-group overrides in the data file.
   *   Neither given -> default range [max(1, count-1), count]. Only one
   *   given -> the other is clamped to it. This means every existing
   *   group already has sane multi-roll behaviour with zero data changes;
   *   add min/max on a specific group only to hand-tune it (e.g. pin a
   *   boss-type group to always roll 1 by setting min=max=1).
   */
  function countForRoll(group, rollsInBatch) {
    const base = Math.max(1, Number(group.count) || 1);

    if (rollsInBatch <= 1) {
      return base;
    }

    const range = rangeForGroup(group, base);

    return range.min + randInt(range.max - range.min + 1);
  }

  // The [min, max] a group's count randomizes within, independent of
  // whether that's driven by rollsInBatch (mode 1) or always-on (mode 2).
  function rangeForGroup(group, base) {
    let min = Number.isFinite(group.min) ? Math.max(1, Math.floor(group.min)) : null;
    let max = Number.isFinite(group.max) ? Math.max(1, Math.floor(group.max)) : null;

    if (min === null && max === null) {
      min = Math.max(1, base - 1);
      max = base;
    } else if (min === null) {
      min = Math.max(1, Math.min(max, base - 1));
    } else if (max === null) {
      max = Math.max(min, base);
    }

    if (min > max) {
      [min, max] = [max, min];
    }

    return { min, max };
  }

  /*
   * Roll `rolls` groups from category+tier — each pick is independent,
   * so the same group CAN come up more than once (e.g. "Bandits x1,
   * Bandits x2, Loners x2" is a valid triple roll). Each entry:
   *
   *   {
   *     category: 'mutants',
   *     tier: 'Advanced',
   *     group: 'snorks',
   *     label: 'Snorks',
   *     icon: '/mutant-icons/mutant_part_snork_mask.png',   // or null
   *     sections: ['snork_strong', ...],
   *     count: 4,
   *     text: 'SNORKS x4',        // for the overlay reel
   *   }
   *
   * Returns [] if the category/tier has no usable groups.
   */
  function rollSpawn(category, tier, rolls = 1) {
    const groups = enabledGroupsFor(category, tier);
    const keys = Object.keys(groups);

    if (keys.length === 0) {
      return [];
    }

    const n = Math.max(1, Math.floor(rolls) || 1);
    const chosen = Array.from({ length: n }, () => keys[randInt(keys.length)]);

    const results = [];

    for (const key of chosen) {
      const group = groups[key];

      const sections = Array.isArray(group.sections)
        ? group.sections.filter((section) => typeof section === 'string' && section.trim())
        : [];

      if (sections.length === 0) {
        continue;
      }

      const count = countForRoll(group, n);
      const label = group.label || key;

      results.push({
        category,
        tier,
        group: key,
        label,
        icon: group.icon || null,
        sections,
        count,
        text: `${label.toUpperCase()} x${count}`,
      });
    }

    return results;
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
    groupLabels,
    groupOptions,
    rollSpawn,
    spawnCommandLines,
    listFactions,
    isFactionEnabled,
    setFactionEnabled,
    countForRoll,
    rangeForGroup,
  };
}

module.exports = { createEnemyPool, randInt, CATEGORIES, TIER_ORDER };
