/*
 * Shared random helpers. Two integer flavors on purpose, named apart so
 * they can't be confused: `randBelow(max)` is an index in [0, max) (for
 * arrays), `randInt(min, max)` is inclusive on both ends (for ranges).
 */

function randBelow(max) {
  return Math.floor(Math.random() * max);
}

function randInt(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);

  return lo + randBelow(hi - lo + 1);
}

function randFloat(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);

  return lo + Math.random() * (hi - lo);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function pick(list) {
  return list[randBelow(list.length)];
}

function shuffle(list) {
  const copy = [...list];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = randBelow(i + 1);

    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

module.exports = { randBelow, randInt, randFloat, round2, pick, shuffle };
