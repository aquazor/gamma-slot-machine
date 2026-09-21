const { EventEmitter } = require('events');

const items = require('./items.data.json');
const bridge = require('./gamma-bridge.cjs');
const enemies = require('./enemies.cjs');
const enemiesMode2 = require('./enemies-mode2.cjs');
const perks = require('./positive-effects.cjs');
const negativeEffects = require('./negative-effects.cjs');
const {
  PRESETS,
  DEFAULT_PRESET,
  DEFAULT_SPAWN_TIER,
  CUSTOM_POWER_UPS_ENABLED,
  CUSTOM_POWER_UPS,
} = require('./config.cjs');

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

/*
 * How many slots/groups a "random" reward or sub event rolls — 1 to 3
 * inclusive, picked fresh each time. A def/event can still pin an exact
 * number (see 'manual'/'manual-spawn' below); only an unset rolls/count
 * falls back to this.
 */
function randomSlotCount() {
  return 1 + randInt(3);
}

/*
 * Every subscription-family event (new sub, resub, single gift) rolls
 * one of loot / enemy squads / mutants / a perk with equal 1/4 odds, then
 * a random 1-3 count for loot/spawn — unless `forceTriple` (a multi-sub
 * gift bomb), which always rolls exactly 3. Perks have no count to scale
 * (one perk is one perk), so `forceTriple` only affects loot/spawn odds
 * of landing on this outcome in the first place, not what happens once it
 * does. Which outcome landed is only visible once the reels stop, same as
 * any other roll.
 */
function subEventOutcome(label, forceTriple) {
  const category = pick(['loot', 'enemies', 'mutants', 'perk']);
  const rolls = forceTriple ? 3 : randomSlotCount();

  if (category === 'loot') {
    return { label, count: rolls };
  }

  if (category === 'perk') {
    return { mode: 'perk', label };
  }

  // forceTriple (a multi-sub gift bomb) also guarantees a spawn bonus
  // in roll mode 2 — ignored entirely by mode 1, which has no concept
  // of bonuses and just uses `rolls` as before.
  return { mode: 'spawn', label, category, rolls, forceBonus: forceTriple };
}

/*
 * Custom Power-ups have no create/manage API (Twitch only exposes a
 * read-only list as of this writing), so there's no reward id to sync —
 * matched by `title` instead, same as CHANNEL_POINT_REWARDS.
 */
function planForPowerUp(title) {
  return CUSTOM_POWER_UPS.find((def) => def.title === title) || null;
}

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
          rolls: Number.isFinite(def.rolls) && def.rolls > 0 ? def.rolls : randomSlotCount(),
        };
      }

      if (def.kind === 'perk') {
        return { mode: 'perk', label: name.toUpperCase() };
      }

      if (def.kind === 'negative') {
        return { mode: 'negative', label: name.toUpperCase() };
      }

      return {
        mode: 'loot',
        label: name.toUpperCase(),
        count: Number.isFinite(def.count) && def.count > 0 ? def.count : randomSlotCount(),
      };
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

    case 'manual-perk':
      return { mode: 'perk', label: 'MANUAL POSITIVE EFFECT' };

    case 'manual-negative':
      return { mode: 'negative', label: 'MANUAL NEGATIVE EFFECT' };

    case 'subscribe':
      // Gifted-sub recipients arrive here with isGift=true; the
      // gifter's `gift` event is what we reward, so skip these.
      if (event.isGift) {
        return null;
      }

      return subEventOutcome('NEW SUB', false);

    case 'resub':
      return subEventOutcome(event.months ? `RESUB x${event.months}` : 'RESUB', false);

    case 'gift': {
      const total = event.total || 1;

      return subEventOutcome(`${total} GIFT SUB${total > 1 ? 'S' : ''}`, total > 1);
    }

    case 'power_up': {
      if (!CUSTOM_POWER_UPS_ENABLED) {
        return null;
      }

      const def = planForPowerUp(event.powerUpTitle);

      if (!def) {
        return null;
      }

      const label = (event.powerUpTitle || 'BITS POWER-UP').toUpperCase();

      // Bits power-ups always give the max roll (3) and, wherever a bonus
      // concept exists (Count Roll spawns, positive effects), always land
      // one — bits cost real money, so a power-up redemption should feel
      // like a guaranteed best-case roll, not a regular one.
      if (def.kind === 'spawn') {
        return { mode: 'spawn', label, category: def.category, rolls: 3, forceBonus: true };
      }

      if (def.kind === 'perk') {
        return { mode: 'perk', label, forceBonus: true };
      }

      if (def.kind === 'negative') {
        return { mode: 'negative', label, forceBonus: true };
      }

      return { mode: 'loot', label, count: 3 };
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
    this.rollMode = 'count-roll';
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

  setRollMode(mode) {
    if (mode === 'random' || mode === 'count-roll') {
      this.rollMode = mode;

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
      rollMode: this.rollMode,
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

    let job;

    if (plan.mode === 'spawn') {
      job = this._buildSpawnJob(event, plan);
    } else if (plan.mode === 'perk') {
      job = this._buildPerkJob(event, plan);
    } else if (plan.mode === 'negative') {
      job = this._buildNegativeEffectJob(event, plan);
    } else {
      job = this._buildLootJob(event, plan);
    }

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

  /*
   * A perk roll (Immortality / Give Ammo / Give Money / Medicine) —
   * dual-slot, same shape as Count Roll's count+species mechanic: slot 1
   * picks WHICH perk (weighted by each perk's own chance among enabled
   * ones), slot 2 rolls that perk's own value (see
   * positive-effects.cjs's rollPerkValue). `results` reuses the same
   * single-text-reel shape mode 1's spawn results use for BOTH slots, so
   * the overlay can render them with its existing reel component
   * unchanged.
   */
  _buildPerkJob(event, plan) {
    const perk = perks.rollPerk();

    if (!perk) {
      console.error('Roulette: no perks enabled');

      return null;
    }

    // Medicine's own item list is keyed by this same spawn tier — every
    // other perk ignores it. `plan.forceBonus` (bits power-ups) guarantees
    // this perk's own bonus lands instead of the normal per-roll chance.
    const perkValue = perks.rollPerkValue(perk.key, this.spawnTier, Boolean(plan.forceBonus));

    if (!perkValue) {
      console.error(`Roulette: perk "${perk.key}" has no rollable value`);

      return null;
    }

    return {
      id: `perk_${Date.now()}_${++this._seq}`,
      user: event.user || 'Anonymous',
      label: plan.label,
      mode: 'perk',
      kind: event.kind,
      perk,
      perkValue,
      // Drives the same gold glow + pulsing "BONUS" badge the count-roll
      // spawn bonuses already use — see Overlay.tsx's `ov-root--bonus`.
      // Always a plain "BONUS" (empty label) — the specific effect (x2,
      // +30s, which medical item, ...) is already spelled out in the
      // result line(s) below, this top badge is just the "something
      // special happened" flag.
      bonus: perkValue.bonus
        ? { key: perkValue.bonus.key, label: '', type: perkValue.bonus.type }
        : null,
      perkPool: perks.listPerks().map((p) => ({ label: p.label, icon: p.icon })),
      perkValuePool: perks.perkValuePool(perk.key, this.spawnTier),
      results: [
        {
          slot: 'perk',
          // Medicine's bonus is a genuinely separate extra item, so slot 1
          // calls out that something's riding along (the specific item
          // shows in slot 2's own result line). The other perks' bonuses
          // are just a modifier on slot 2's own number — already fully
          // expressed there ("45s" lands, result line reads "75s (+30s
          // bonus)"), so slot 1 stays on the plain perk name for those.
          name: perk.key === 'medicine' && perkValue.bonus ? `${perk.label} + bonus` : perk.label,
          label: perk.label,
          icon: perk.icon,
        },
        {
          slot: 'perk-value',
          name: perkValue.fullLabel || perkValue.label,
          label: perkValue.label,
          icon: perkValue.icon,
        },
      ],
      createdAt: Date.now(),
    };
  }

  /*
   * A negative effect roll — same dual-slot shape as _buildPerkJob, except
   * some effects (Drop Weapon, Empty Pockets) have no second roll at all
   * (negativeEffects.hasValueRoll === false): `results` then has just the
   * one entry and the overlay should render a single reel for those.
   */
  _buildNegativeEffectJob(event, plan) {
    const effect = negativeEffects.rollNegativeEffect();

    if (!effect) {
      console.error('Roulette: no negative effects enabled');

      return null;
    }

    const effectValue = effect.hasValueRoll
      ? negativeEffects.rollEffectValue(effect.key, Boolean(plan.forceBonus))
      : null;

    if (effect.hasValueRoll && !effectValue) {
      console.error(`Roulette: negative effect "${effect.key}" has no rollable value`);

      return null;
    }

    const results = [
      {
        slot: 'negative',
        name: effect.label,
        label: effect.label,
        icon: effect.icon,
      },
    ];

    if (effectValue) {
      results.push({
        slot: 'negative-value',
        name: effectValue.fullLabel || effectValue.label,
        label: effectValue.label,
        icon: effectValue.icon,
      });
    }

    return {
      id: `negative_${Date.now()}_${++this._seq}`,
      user: event.user || 'Anonymous',
      label: plan.label,
      mode: 'negative',
      kind: event.kind,
      effect,
      effectValue,
      bonus: effectValue && effectValue.bonus
        ? { key: effectValue.bonus.key, label: '', type: effectValue.bonus.type }
        : null,
      effectPool: negativeEffects.listEffects().map((e) => ({ label: e.label, icon: e.icon })),
      effectValuePool: effectValue ? negativeEffects.effectValuePool(effect.key) : [],
      results,
      createdAt: Date.now(),
    };
  }

  _buildSpawnJob(event, plan) {
    const category = plan.category === 'enemies' ? 'enemies' : 'mutants';
    const tier = this.spawnTier;

    if (this.rollMode === 'count-roll') {
      return this._buildSpawnJobCountRoll(event, plan, category, tier);
    }

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
   * "Count roll" mode: exactly one dual-slot roll (species + its own
   * count), never N independent picks — see enemies-mode2.cjs for why
   * `plan.rolls` is not used here. `plan.forceBonus` (a multi-sub gift
   * bomb) guarantees a bonus instead of the normal per-roll chance.
   */
  _buildSpawnJobCountRoll(event, plan, category, tier) {
    const result = enemiesMode2.rollDualSlot(category, tier, Boolean(plan.forceBonus));

    if (!result) {
      console.error(`Roulette: no spawn groups for ${category}/${tier} (mode 2)`);

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
      spawnResults: [result],
      // A fresh object, not `result.bonus` itself — this only drives the
      // top banner's badge/glow, which stays generic ("BONUS", no
      // specifics). The count reel's own inline "(x2 bonus)" text reads
      // straight from `results[0].bonus` below, untouched.
      bonus: result.bonus ? { key: result.bonus.key, label: '', type: result.bonus.type } : null,
      spawnPool: enemiesMode2.groupOptions(category, tier),
      // Count reel rolls first, species reel second — the dual-slot
      // mechanic this mode was built for ("1 слот роллит каунт, второй
      // слот роллит кого спавнить").
      results: [
        {
          slot: 'count',
          name: String(result.count),
          value: result.count,
          baseValue: result.baseCount,
          // Only a count-affecting bonus (multiply/add) belongs on the
          // count reel — 'upgrade' changes the species roll, not this
          // one, so the count reel has nothing to call out for it.
          bonus:
            result.bonus && result.bonus.type !== 'upgrade' ? result.bonus : null,
        },
        {
          slot: 'spawn',
          name: result.text,
          label: result.label,
          group: result.group,
          icon: result.icon,
        },
      ],
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

    let give;

    if (job.mode === 'spawn') {
      give = bridge.writeCommandLines(enemies.spawnCommandLines(job.spawnResults, job.user));
    } else if (job.mode === 'perk') {
      give = bridge.writeCommandLines(
        perks.perkCommandLines(job.perk, job.perkValue, job.user),
      );
    } else if (job.mode === 'negative') {
      give = bridge.writeCommandLines(
        negativeEffects.negativeEffectCommandLines(job.effect, job.effectValue, job.user),
      );
    } else {
      give = bridge.giveLoadout({
        ...resultsToLoadout(job.results),
        message: lootMessage(job),
      });
    }

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
