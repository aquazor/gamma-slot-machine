const { EventEmitter } = require('events');

const items = require('./loot/items.data.json');
const bridge = require('./gamma-bridge.cjs');
const enemies = require('./spawn/enemies-mode2.cjs');
const enemiesLabs = require('./spawn/enemies-labs.cjs');
const perks = require('./effects/positive-effects.cjs');
const negativeEffects = require('./effects/negative-effects.cjs');
const gunAttachments = require('./loot/gun-attachments.cjs');
const { randBelow, pick, shuffle } = require('./utils/random.cjs');
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
  return 1 + randBelow(3);
}

const SUB_CATEGORIES = ['loot', 'enemies', 'mutants', 'perk', 'negative'];

/*
 * One roll's plan for a given outcome category. `forceBonus` is the
 * "guaranteed best case" treatment (bits power-ups, gift-sub batches):
 * loot always uses the maximum count of 3 (and always lands the
 * gun-attachments bonus when a weapon is rolled), spawns land a spawn
 * bonus, and perks / negative effects land their own bonus wherever that
 * effect has one. Otherwise loot/spawn use a random 1-3 count and every
 * bonus is left to its normal per-roll chance.
 */
function subPlanForCategory(label, category, forceBonus) {
  if (category === 'loot') {
    return { label, count: forceBonus ? 3 : randomSlotCount(), forceBonus };
  }

  if (category === 'perk') {
    return { mode: 'perk', label, forceBonus };
  }

  if (category === 'negative') {
    return { mode: 'negative', label, forceBonus };
  }

  return { mode: 'spawn', label, category, forceBonus };
}

/*
 * Every single subscription-family event (new sub, resub, one gifted
 * sub) is one roll of a random category with equal 1/5 odds — loot /
 * enemy squads / mutants / a perk / a negative effect — and no forced
 * bonus. Which outcome landed is only visible once the reels stop.
 */
function subEventOutcome(label) {
  return subPlanForCategory(label, pick(SUB_CATEGORIES), false);
}

/*
 * Gift-sub batches. Gifting 1-4 subs at once is one ordinary random
 * roll; from 5 up, every full GIFT_BATCH_SIZE (5) subs is one roll with a
 * guaranteed bonus — 5 subs = 1 bonus roll, 10 = 2, 15 = 3, ... — and
 * the leftover 1-4 subs are simply dropped (7 subs = 1 bonus roll, 9 = 1,
 * 14 = 2). Only the first MAX_GIFT_SUBS (100) subs count, so a huge bomb
 * is at most 20 rolls and can't clog the overlay queue.
 *
 * Outcome categories within one batch are dealt like a shuffled deck:
 * no category repeats until all five have come up, then a fresh shuffled
 * deck starts (the first card of a new deck never equals the last card
 * of the previous one, so there's no back-to-back repeat at the seam).
 *
 */
const GIFT_BATCH_SIZE = 5;
const MAX_GIFT_SUBS = 100;

function dealCategories(count) {
  const dealt = [];

  while (dealt.length < count) {
    let deck = shuffle(SUB_CATEGORIES);

    if (dealt.length > 0 && deck[0] === dealt[dealt.length - 1]) {
      const swapWith = 1 + randBelow(deck.length - 1);

      [deck[0], deck[swapWith]] = [deck[swapWith], deck[0]];
    }

    dealt.push(...deck);
  }

  return dealt.slice(0, count);
}

function giftLabel(total) {
  return `${total} GIFT SUB${total > 1 ? 'S' : ''}`;
}

function giftPlans(total, label) {
  const subs = Number.isFinite(total) && total >= 1 ? Math.min(Math.floor(total), MAX_GIFT_SUBS) : 1;

  // Under 5 subs: one ordinary roll. From 5 up: one bonus roll per full 5.
  const bonusRolls = Math.floor(subs / GIFT_BATCH_SIZE);
  const rolls = Math.max(bonusRolls, 1);

  return dealCategories(rolls).map((category) =>
    subPlanForCategory(label, category, bonusRolls > 0),
  );
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
      return {
        mode: 'loot',
        label: 'MANUAL ROLL',
        count: event.manualCount || 1,
        forceBonus: Boolean(event.forceBonus),
      };

    case 'manual-spawn':
      return {
        mode: 'spawn',
        label: 'MANUAL SPAWN',
        category: event.category === 'enemies' ? 'enemies' : 'mutants',
        forceBonus: Boolean(event.forceBonus),
      };

    case 'manual-perk':
      return {
        mode: 'perk',
        label: 'MANUAL POSITIVE EFFECT',
        forceBonus: Boolean(event.forceBonus),
      };

    case 'manual-negative':
      return {
        mode: 'negative',
        label: 'MANUAL NEGATIVE EFFECT',
        forceBonus: Boolean(event.forceBonus),
      };

    case 'subscribe':
      // Gifted-sub recipients arrive here with isGift=true; the
      // gifter's `gift` event is what we reward, so skip these.
      if (event.isGift) {
        return null;
      }

      return subEventOutcome('NEW SUB');

    case 'resub':
      return subEventOutcome(event.months ? `RESUB x${event.months}` : 'RESUB');

    case 'gift': {
      const total = event.total || 1;

      return giftPlans(total, giftLabel(total))[0];
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
        return { mode: 'spawn', label, category: def.category, forceBonus: true };
      }

      if (def.kind === 'perk') {
        return { mode: 'perk', label, forceBonus: true };
      }

      if (def.kind === 'negative') {
        return { mode: 'negative', label, forceBonus: true };
      }

      return { mode: 'loot', label, count: 3, forceBonus: true };
    }

    default:
      return null;
  }
}

/*
 * Every roll an event produces, in queue order. Almost every event is a
 * single roll; a gift-sub batch can be several (see giftPlans).
 */
function plansForEvent(event, rewardMap) {
  if (event.kind === 'gift') {
    const total = event.total || 1;

    return giftPlans(total, giftLabel(total));
  }

  const plan = planForEvent(event, rewardMap);

  return plan ? [plan] : [];
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
      .map((r) => ({ itemId: r.itemId, ammo: r.ammo || '', attach: Boolean(r.attach) })),
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
    this.labsMode = false;

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

  /*
   * "Count Roll (labs)" — same dual-slot engine, different roster
   * (enemies.labs.data.json via enemies-labs.cjs): Monolith/UNISG/Sin at
   * every tier, and a mutant roster that can be trimmed independently.
   * The spawn tier selection (Basic/Advanced/Expert) is shared with the
   * normal roster — this only swaps which data backs it.
   */
  setLabsMode(value) {
    this.labsMode = Boolean(value);

    return true;
  }

  _activeSpawnPool() {
    return this.labsMode ? enemiesLabs : enemies;
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
      labsMode: this.labsMode,
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
    const plans = plansForEvent(event, this.rewardMap);

    // Build every job first so a batch is queued back-to-back; returns the
    // first one (the rest are tagged `batch: { index, size }`).
    const jobs = plans.map((plan) => this._buildJob(event, plan)).filter(Boolean);

    if (jobs.length === 0) {
      return null;
    }

    if (jobs.length > 1) {
      jobs.forEach((job, index) => {
        job.batch = { index: index + 1, size: jobs.length };
      });
    }

    for (const job of jobs) {
      this.queue.push(job);
      this.emit('queued', job);
    }

    this._processNext();

    return jobs[0];
  }

  _buildJob(event, plan) {
    if (plan.mode === 'spawn') {
      return this._buildSpawnJob(event, plan);
    }

    if (plan.mode === 'perk') {
      return this._buildPerkJob(event, plan);
    }

    if (plan.mode === 'negative') {
      return this._buildNegativeEffectJob(event, plan);
    }

    return this._buildLootJob(event, plan);
  }

  /*
   * "Roll guns with attachments" bonus (see gun-attachments.cjs) — if this
   * roll included a weapon slot, it has a flat CHANCE of landing with a
   * scope/silencer already attached (the game side works out what
   * actually fits). `plan.forceBonus` (a gift-sub bonus roll or a bits
   * power-up) guarantees it lands instead, same "best case" treatment
   * every other bonus in this app gets.
   */
  _buildLootJob(event, plan) {
    const grades = PRESETS[this.preset];
    const results = rollItems(plan.count, grades);

    const weaponResult = results.find((r) => r.slot === 'weapon');
    const attachmentsLanded =
      Boolean(weaponResult) &&
      gunAttachments.isEnabled() &&
      (Boolean(plan.forceBonus) || Math.random() < gunAttachments.CHANCE);

    if (attachmentsLanded) {
      weaponResult.attach = true;
    }

    return {
      id: `roll_${Date.now()}_${++this._seq}`,
      user: event.user || 'Anonymous',
      label: plan.label,
      mode: 'loot',
      kind: event.kind,
      preset: this.preset,
      grades, // { weapon: [...], helmet: [...], armor: [...] } — for the overlay reel
      results,
      bonus: attachmentsLanded
        ? { key: 'gun-attachments', label: '', type: 'attachments' }
        : null,
      createdAt: Date.now(),
    };
  }

  /*
   * A perk roll (Immortality / Give Ammo / Give Money / Medicine / Food &
   * Water) — dual-slot, same shape as the spawn roll's count+species
   * mechanic: slot 1 picks WHICH perk (weighted by each perk's own chance
   * among enabled ones), slot 2 rolls that perk's own value (see
   * positive-effects.cjs's rollPerkValue). `results` uses the same
   * single-text-reel shape for both slots, so the overlay can render them
   * with its existing reel component unchanged.
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
   *
   * Drop Weapon and Empty Pockets are the exception to the exception —
   * each carries its own small `doubleBonus` chance of landing BOTH of
   * them at once (see rollDoubleBonusEffect). A null return there is the
   * normal, expected outcome (bonus just didn't land this time), unlike
   * the hasValueRoll branch above it, where null means something's wrong.
   */
  _buildNegativeEffectJob(event, plan) {
    const effect = negativeEffects.rollNegativeEffect();

    if (!effect) {
      console.error('Roulette: no negative effects enabled');

      return null;
    }

    let effectValue = null;

    if (effect.hasValueRoll) {
      effectValue = negativeEffects.rollEffectValue(effect.key, Boolean(plan.forceBonus));

      if (!effectValue) {
        console.error(`Roulette: negative effect "${effect.key}" has no rollable value`);

        return null;
      }
    } else if (effect.def && effect.def.doubleBonus) {
      effectValue = negativeEffects.rollDoubleBonusEffect(effect, Boolean(plan.forceBonus));
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

  /*
   * Exactly one dual-slot roll (species + its own count), never N
   * independent picks. `plan.forceBonus` (a gift-sub bonus roll or a bits
   * power-up) guarantees a bonus instead of the normal per-roll chance.
   */
  _buildSpawnJob(event, plan) {
    const category = plan.category === 'enemies' ? 'enemies' : 'mutants';
    const tier = this.spawnTier;
    const pool = this._activeSpawnPool();

    const result = pool.rollDualSlot(category, tier, Boolean(plan.forceBonus));

    if (!result) {
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
      labsMode: this.labsMode,
      spawnResults: [result],
      // A fresh object, not `result.bonus` itself — this only drives the
      // top banner's badge/glow, which stays generic ("BONUS", no
      // specifics). The count reel's own inline "(x2 bonus)" text reads
      // straight from `results[0].bonus` below, untouched.
      bonus: result.bonus ? { key: result.bonus.key, label: '', type: result.bonus.type } : null,
      spawnPool: pool.groupOptions(category, tier),
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
      const pool = job.labsMode ? enemiesLabs : enemies;

      give = bridge.writeCommandLines(pool.spawnCommandLines(job.spawnResults, job.user));
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

module.exports = { Roulette, planForEvent, plansForEvent, rollItems, POOLS };
