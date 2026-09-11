const data = require('./enemies.data.json');

/*
 * ---------------------------------------------------------
 * SPAWN POOLS
 * ---------------------------------------------------------
 * enemies.data.json is tier-first:
 *
 *   <category> -> <tier> -> <group> -> { label, sections, count }
 *
 * A spawn roll picks ONE random group from the chosen
 * category + tier, then spawns `count` creatures, each a
 * random pick from that group's `sections` (the Lua side
 * does the per-creature random pick from the ';' list).
 *
 * Categories:
 *   mutants  — creatures (dogs, snorks, chimeras, ...)
 *   enemies  — armed NPC factions (bandits, military, ...)
 */

const CATEGORIES = ['mutants', 'enemies'];
const TIER_ORDER = ['Basic', 'Advanced', 'Expert'];

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

function groupsFor(category, tier) {
  const cat = data[category] || {};

  return cat[tier] || {};
}

/*
 * ---------------------------------------------------------
 * ENEMY FACTION TOGGLES
 * ---------------------------------------------------------
 * Streamers pick which armed factions they want spawnable at all
 * (e.g. never Duty, if that clashes with their playthrough) — this
 * is a blanket on/off per faction key, the SAME across every tier
 * (a faction disabled in Basic is also off in Advanced/Expert), unlike
 * mutants where inclusion is just baked into enemies.data.json per tier.
 *
 * Runtime-only, like preset/spawnTier — resets on server restart.
 * Only applies to the 'enemies' category; mutants are unaffected.
 */
const disabledFactions = new Set();

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
 * Snapshot for the settings UI: every faction key with its label/icon
 * (pulled from whichever tier defines it first) and current enabled state.
 */
function listFactions() {
  return factionKeys().map((key) => {
    const def = factionDef(key);

    return {
      key,
      label: (def && def.label) || key,
      icon: (def && def.icon) || null,
      enabled: isFactionEnabled(key),
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

function randInt(max) {
  return Math.floor(Math.random() * max);
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
 *   `min`/`max` are optional per-group overrides in enemies.data.json.
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

  return min + randInt(max - min + 1);
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

module.exports = {
  CATEGORIES,
  isCategory,
  tiersFor,
  spawnTiers,
  groupsFor,
  groupLabels,
  groupOptions,
  rollSpawn,
  spawnCommandLines,
  listFactions,
  isFactionEnabled,
  setFactionEnabled,
};
