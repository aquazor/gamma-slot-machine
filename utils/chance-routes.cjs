/*
 * The GET list + POST toggle / chance / reset endpoints shared by every
 * tunable catalog on the /tweaking page (spawn bonuses for each roster,
 * positive effects, negative effects). Each catalog just supplies its
 * accessors; validation, logging and the response shape live here once.
 */

function registerChanceRoutes(app, { base, label, resetLabel, responseKey, list, setEnabled, setChance, reset }) {
  const respond = (res) => res.json({ [responseKey]: list() });

  function requireKey(req, res) {
    const { key } = req.body || {};

    if (typeof key !== 'string' || !key) {
      res.status(400).json({ error: 'key is required' });

      return null;
    }

    return key;
  }

  app.get(base, (req, res) => respond(res));

  app.post(`${base}/toggle`, (req, res) => {
    const key = requireKey(req, res);

    if (!key) {
      return;
    }

    const enabled = Boolean(req.body.enabled);

    setEnabled(key, enabled);

    console.log(`Roulette ${label} "${key}" -> ${enabled ? 'enabled' : 'disabled'}`);

    respond(res);
  });

  app.post(`${base}/chance`, (req, res) => {
    const key = requireKey(req, res);

    if (!key) {
      return;
    }

    const { chance } = req.body;

    if (typeof chance !== 'number' || !Number.isFinite(chance)) {
      return res.status(400).json({ error: 'chance must be a number' });
    }

    setChance(key, chance);

    console.log(`Roulette ${label} "${key}" chance -> ${(chance * 100).toFixed(1)}%`);

    respond(res);
  });

  app.post(`${base}/reset`, (req, res) => {
    reset();

    console.log(`Roulette ${resetLabel} -> restored to defaults`);

    respond(res);
  });
}

module.exports = { registerChanceRoutes };
