const { randBelow } = require('./random.cjs');

/*
 * Pick at most one entry from a list of `{ chance }` bonuses. Each entry
 * claims its own slice of [0,1): under 100% enabled, the leftover is "no
 * bonus" (returns null); at/above 100%, or with `forceGuaranteed` (bits
 * power-ups, gift bombs), a bonus is always drawn, split proportionally by
 * relative chance so the first entry doesn't win every time. An empty list
 * or one with no positive chance at all yields null.
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

/*
 * Index of one entry picked by relative weight (weights needn't add up to
 * anything in particular). All-zero/invalid weights fall back to a uniform
 * pick rather than never rolling anything. -1 for an empty list.
 */
function pickWeightedIndex(weights) {
  if (weights.length === 0) {
    return -1;
  }

  const total = weights.reduce((sum, w) => sum + w, 0);

  if (total <= 0) {
    return randBelow(weights.length);
  }

  let roll = Math.random() * total;

  for (let i = 0; i < weights.length; i++) {
    if (roll < weights[i]) {
      return i;
    }

    roll -= weights[i];
  }

  return weights.length - 1; // float-rounding fallback
}

module.exports = { rollWeightedBonus, pickWeightedIndex };
