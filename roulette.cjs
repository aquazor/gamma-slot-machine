const { EventEmitter } = require('events');

const items = require('./items.data.json');
const bridge = require('./gamma-bridge.cjs');
const enemies = require('./enemies.cjs');
const { PRESETS, DEFAULT_PRESET, DEFAULT_SPAWN_TIER } = require('./config.cjs');

/*
 * ---------------------------------------------------------
 * POOLS
 * ---------------------------------------------------------
 * Flat, equal-probability pools per slot. Rarity / weighting
 * can be layered on later without touching the queue logic.
 */

const POOLS = {
  weapon: items.weapons,
  helmet: items.helmets,
  armor: items.armor,
};

const ALL_SLOTS = ['weapon', 'helmet', 'armor'];

/*
 * Safety cap: if the overlay never reports its animation
 * finished, complete the job anyway after this long.
 */
const OVERLAY_TIMEOUT_MS = 45 * 1000;

/*
 * When no overlay is connected, don't stall the queue waiting
 * for an animation that will never play.
 */
const NO_OVERLAY_DELAY_MS = 1500;

/*
 * ---------------------------------------------------------
 * ROLLING
 * ---------------------------------------------------------
 */

function randInt(max) {
  return Math.floor(Math.random() * max);
}

function pick(arr) {
  return arr[randInt(arr.length)];
}

function shuffle(arr) {
  const copy = [...arr];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(i + 1);

    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

/*
 * Choose which slots to roll:
 *   3+ -> weapon + helmet + armor
 *   1-2 -> that many distinct random slots
 */
function pickSlots(count) {
  if (count >= ALL_SLOTS.length) {
    return [...ALL_SLOTS];
  }

  return shuffle(ALL_SLOTS).slice(0, Math.max(1, count));
}

/*
 * Slot pool narrowed to the preset's allowed `repair` grades.
 * Falls back to the full pool if the filter leaves nothing.
 */
function poolForSlot(slot, grades) {
  const full = POOLS[slot];
  const allowed = grades && grades[slot];

  if (!allowed || allowed.length === 0) {
    return full;
  }

  const filtered = full.filter((item) => allowed.includes(item.repair));

  return filtered.length > 0 ? filtered : full;
}

function rollItems(count, grades) {
  return pickSlots(count).map((slot) => {
    const item = pick(poolForSlot(slot, grades));

    const result = { slot, itemId: item.id, name: item.name };

    if (slot === 'weapon') {
      result.ammo = item.ammo || '';
    }

    return result;
  });
}

/*
 * ---------------------------------------------------------
 * EVENT -> ROLL PLAN
 * ---------------------------------------------------------
 * `event` is the normalized object from twitch-eventsub.cjs.
 * Returns { label, count } or null to skip.
 */

function planForEvent(event, rewardMap) {
  switch (event.kind) {
    case 'reward': {
      // Only our own managed channel-point rewards trigger a roll.
      const def = rewardMap && rewardMap.get(event.rewardId);

      if (!def) {
        return null;
      }

      const name = event.rewardTitle || def.title || 'Channel points';

      if (def.kind === 'spawn') {
        return {
          mode: 'spawn',
          label: name.toUpperCase(),
          category: def.category || 'mutants',
          rolls: def.rolls || 1,
        };
      }

      return { mode: 'loot', label: name.toUpperCase(), count: def.count || 1 };
    }

    case 'manual':
      return { mode: 'loot', label: 'MANUAL ROLL', count: event.manualCount || 1 };

    case 'manual-spawn':
      return {
        mode: 'spawn',
        label: 'MANUAL SPAWN',
        category: event.category === 'enemies' ? 'enemies' : 'mutants',
        rolls: event.rolls || 1,
      };

    case 'subscribe':
      // Gifted-sub recipients arrive here with isGift=true; the
      // gifter's `gift` event is what we reward, so skip these.
      if (event.isGift) {
        return null;
      }

      return { label: 'NEW SUB', count: 1 };

    case 'resub':
      return {
        label: event.months ? `RESUB x${event.months}` : 'RESUB',
        count: 1,
      };

    case 'gift': {
      const total = event.total || 1;

      return {
        label: `${total} GIFT SUB${total > 1 ? 'S' : ''}`,
        count: total >= 5 ? 3 : 1,
      };
    }

    case 'cheer': {
      const bits = event.bits || 0;

      if (bits >= 500) {
        return { label: `${bits} BITS`, count: 3 };
      }

      if (bits >= 300) {
        return { label: `${bits} BITS`, count: 2 };
      }

      if (bits >= 100) {
        return { label: `${bits} BITS`, count: 1 };
      }

      return null;
    }

    default:
      return null;
  }
}

/*
 * ---------------------------------------------------------
 * COMMAND PAYLOAD
 * ---------------------------------------------------------
 */

function resultsToLoadout(results) {
  return {
    weapons: results
      .filter((r) => r.slot === 'weapon')
      .map((r) => ({ itemId: r.itemId, ammo: r.ammo || '' })),
    helmets: results
      .filter((r) => r.slot === 'helmet')
      .map((r) => ({ itemId: r.itemId })),
    outfits: results
      .filter((r) => r.slot === 'armor')
      .map((r) => ({ itemId: r.itemId })),
  };
}

/*
 * Green in-game notification for a loot roll: "<user> - AK-74, Battle Helmet".
 */
function lootMessage(job) {
  const names = job.results.map((r) => r.name).filter(Boolean).join(', ');

  return names ? `${job.user} - ${names}` : `${job.user} - loadout`;
}

/*
 * ---------------------------------------------------------
 * QUEUE
 * ---------------------------------------------------------
 * Events emitted:
 *   'queued'   job
 *   'roll'     job       (overlay should animate this now)
 *   'complete' record    (animation done / timed out; item given)
 */

class Roulette extends EventEmitter {
  constructor() {
    super();

    this.queue = [];
    this.current = null;
    this.processing = false;

    this.overlayPresent = false;
    this.rewardMap = null;
    this.preset = PRESETS[DEFAULT_PRESET] ? DEFAULT_PRESET : Object.keys(PRESETS)[0];

    const spawnTiers = enemies.spawnTiers();
    this.spawnTier = spawnTiers.includes(DEFAULT_SPAWN_TIER)
      ? DEFAULT_SPAWN_TIER
      : spawnTiers[0] || 'Basic';

    this.history = [];
    this._seq = 0;
    this._timer = null;
  }

  setRewardMap(map) {
    this.rewardMap = map || null;
  }

  setPreset(name) {
    if (PRESETS[name]) {
      this.preset = name;

      return true;
    }

    return false;
  }

  setSpawnTier(name) {
    if (enemies.spawnTiers().includes(name)) {
      this.spawnTier = name;

      return true;
    }

    return false;
  }

  setOverlayPresent(value) {
    const wasPresent = this.overlayPresent;

    this.overlayPresent = Boolean(value);

    // Overlay just went away mid-job — don't hold the queue for
    // the full safety timeout waiting on an animation nobody sees.
    if (wasPresent && !this.overlayPresent && this.current) {
      clearTimeout(this._timer);

      this._timer = setTimeout(() => {
        this._completeCurrent('no-overlay');
      }, NO_OVERLAY_DELAY_MS);
    }
  }

  getState() {
    return {
      overlayPresent: this.overlayPresent,
      preset: this.preset,
      presets: Object.keys(PRESETS),
      spawnTier: this.spawnTier,
      spawnTiers: enemies.spawnTiers(),
      queued: this.queue.length,
      current: this.current,
      history: this.history.slice(0, 10),
    };
  }

  /*
   * Feed a normalized Twitch event. Returns the created job,
   * or null if the event doesn't trigger a roll.
   */
  handleEvent(event) {
    const plan = planForEvent(event, this.rewardMap);

    if (!plan) {
      return null;
    }

    const job =
      plan.mode === 'spawn'
        ? this._buildSpawnJob(event, plan)
        : this._buildLootJob(event, plan);

    if (!job) {
      return null;
    }

    this.queue.push(job);
    this.emit('queued', job);
    this._processNext();

    return job;
  }

  _buildLootJob(event, plan) {
    const grades = PRESETS[this.preset];

    return {
      id: `roll_${Date.now()}_${++this._seq}`,
      user: event.user || 'Anonymous',
      label: plan.label,
      mode: 'loot',
      kind: event.kind,
      preset: this.preset,
      grades, // { weapon: [...], helmet: [...], armor: [...] } — for the overlay reel
      results: rollItems(plan.count, grades),
      createdAt: Date.now(),
    };
  }

  _buildSpawnJob(event, plan) {
    const category = plan.category === 'enemies' ? 'enemies' : 'mutants';
    const tier = this.spawnTier;
    const rolls = Math.min(3, Math.max(1, Number(plan.rolls) || 1));

    const spawnResults = enemies.rollSpawn(category, tier, rolls);

    if (spawnResults.length === 0) {
      console.error(`Roulette: no spawn groups for ${category}/${tier}`);

      return null;
    }

    return {
      id: `spawn_${Date.now()}_${++this._seq}`,
      user: event.user || 'Anonymous',
      label: plan.label,
      mode: 'spawn',
      kind: event.kind,
      category,
      spawnTier: tier,
      spawnResults,
      // spinning filler for the overlay's spawn reels — {label, icon} pairs
      spawnPool: enemies.groupOptions(category, tier),
      results: spawnResults.map((r) => ({
        slot: 'spawn',
        name: r.text, // "BOARS x2" — shown in the small result line under the reel
        label: r.label, // "Boars" — shown in the reel itself (no count)
        group: r.group,
        icon: r.icon,
      })),
      createdAt: Date.now(),
    };
  }

  /*
   * Overlay reports all reels have landed — hand the loadout to the
   * game NOW, without waiting for the result screen to fade out.
   */
  deliver(id) {
    if (this.current && this.current.id === id && !this.current.delivered) {
      this._deliverCurrent('overlay');
    }
  }

  /*
   * Overlay reports its result screen has fully faded — safe to
   * advance the queue to the next job.
   */
  finish(id) {
    if (this.current && this.current.id === id) {
      this._completeCurrent('overlay');
    }
  }

  _processNext() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    this.current = this.queue.shift();

    this.emit('roll', this.current);

    const wait = this.overlayPresent ? OVERLAY_TIMEOUT_MS : NO_OVERLAY_DELAY_MS;

    this._timer = setTimeout(() => {
      this._completeCurrent(this.overlayPresent ? 'timeout' : 'no-overlay');
    }, wait);
  }

  /*
   * Write the job's items to the game. Runs as soon as the reels
   * land (via deliver()), or as a fallback from _completeCurrent()
   * if the overlay never signalled.
   */
  _deliverCurrent(reason) {
    const job = this.current;

    if (!job || job.delivered) {
      return;
    }

    const give =
      job.mode === 'spawn'
        ? bridge.writeCommandLines(
            enemies.spawnCommandLines(job.spawnResults, job.user),
          )
        : bridge.giveLoadout({
            ...resultsToLoadout(job.results),
            message: lootMessage(job),
          });

    if (!give.ok) {
      console.error(`Roulette: failed to deliver ${job.id}: ${give.error}`);
    }

    job.delivered = true;
    job.deliverReason = reason;
    job.give = give;

    this.emit('delivered', {
      id: job.id,
      user: job.user,
      label: job.label,
      mode: job.mode,
      results: job.results,
      spawnResults: job.spawnResults || [],
      given: give.ok,
      giveError: give.ok ? null : give.error,
      reason,
    });
  }

  _completeCurrent(reason) {
    if (!this.current) {
      return;
    }

    clearTimeout(this._timer);
    this._timer = null;

    const job = this.current;

    // Fallback: no overlay, or it never told us the reels landed.
    if (!job.delivered) {
      this._deliverCurrent(reason);
    }

    const give = job.give || { ok: false, error: 'not given' };

    const record = {
      ...job,
      completedAt: Date.now(),
      reason,
      given: give.ok,
      giveError: give.ok ? null : give.error,
    };

    this.history.unshift(record);
    this.history = this.history.slice(0, 50);

    this.emit('complete', record);

    this.current = null;
    this.processing = false;

    this._processNext();
  }
}

module.exports = { Roulette, planForEvent, rollItems, POOLS };
