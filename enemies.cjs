/*
 * Mode 1 (current/default) spawn pool — thin wrapper over enemy-pool.cjs
 * bound to enemies.data.json. Public API unchanged so existing callers
 * (roulette.cjs, server.cjs) don't need to know this is now shared logic.
 * Mode 2 (enemies-mode2.cjs) is a separate instance over a separate data
 * file — neither shares state (faction toggles, etc.) with the other.
 */

const { createEnemyPool } = require('./enemy-pool.cjs');
const data = require('./enemies.data.json');

module.exports = createEnemyPool(data);
