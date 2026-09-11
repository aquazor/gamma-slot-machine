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
 * Every group's display label for a category + tier — the overlay
 * uses this as the spinning filler for the spawn reel.
 */
function groupLabels(category, tier) {
  const groups = groupsFor(category, tier);

  return Object.keys(groups).map((key) => groups[key].label || key);
}

function randInt(max) {
  return Math.floor(Math.random() * max);
}

/*
 * Roll one spawn. Returns null if the category/tier has no groups.
 *
 *   {
 *     category: 'mutants',
 *     tier: 'Advanced',
 *     group: 'snorks',
 *     label: 'Snorks',
 *     sections: ['snork_strong', ...],
 *     count: 4,
 *     text: 'SNORKS x4',        // for the overlay reel
 *   }
 */
function rollSpawn(category, tier) {
  const groups = groupsFor(category, tier);
  const keys = Object.keys(groups);

  if (keys.length === 0) {
    return null;
  }

  const key = keys[randInt(keys.length)];
  const group = groups[key];

  const sections = Array.isArray(group.sections)
    ? group.sections.filter((section) => typeof section === 'string' && section.trim())
    : [];

  if (sections.length === 0) {
    return null;
  }

  const count = Math.max(1, Number(group.count) || 1);
  const label = group.label || key;

  return {
    category,
    tier,
    group: key,
    label,
    sections,
    count,
    text: `${label.toUpperCase()} x${count}`,
  };
}

/*
 * Turn a rolled spawn into command.txt lines. The MSG line is
 * red in-game (kind = spawn); SPAWN carries the ';'-joined
 * sections and the creature count.
 */
function spawnCommandLines(roll, user) {
  if (!roll || !roll.sections || roll.sections.length === 0) {
    return [];
  }

  const who = (typeof user === 'string' && user.trim()) || 'Someone';

  return [
    `MSG|spawn|${who} - ${roll.label} x${roll.count}`,
    `SPAWN|${roll.sections.join(';')}|${roll.count}`,
  ];
}

module.exports = {
  CATEGORIES,
  isCategory,
  tiersFor,
  spawnTiers,
  groupsFor,
  groupLabels,
  rollSpawn,
  spawnCommandLines,
};
