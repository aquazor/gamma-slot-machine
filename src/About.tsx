import './Settings.css';
import './About.css';

import Navbar from './Navbar';

const GITHUB_URL = 'https://github.com/aquazor/gamma-slot-machine/tree/dev';
const SETUP_GUIDE_URL = 'https://aquazor.github.io/gamma-slot-machine/';

export default function About() {
  return (
    <>
      <Navbar />

      <div className="set-root">
        <div className="set-card about-card">
          <h1 className="set-title">ℹ️ About This App</h1>

          <p className="set-muted about-tagline">
            The app and this mod are both a work in progress, but it already works quite
            well. Found a bug? Message{' '}
            <span className="about-discord">
              <span className="about-discord-icon" aria-hidden="true">
                💬
              </span>
              aquazor
            </span>{' '}
            on Discord.
          </p>

          <div className="about-links">
            <a
              className="set-link"
              href={SETUP_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="set-link-icon">📖</span>
              Setup guide
            </a>
            <a
              className="set-link"
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="set-link-icon">🐙</span>
              View source on GitHub
            </a>
          </div>

          <section className="set-section">
            <h2 className="set-heading">Setup</h2>

            <p>Two separate pieces, both needed:</p>

            <ol className="about-list">
              <li>
                <strong>GAMMA Randomizer Slot Machine by rip_perri</strong> — the in-game
                mod. Install it with MO2 like any other regular mod.
                <br />
                <strong>Important:</strong> do not rename the mod, and choose the Anomaly
                Launcher when running GAMMA (debug mode is not required).
              </li>
              <li>
                <strong>GAMMA Slot Machine App</strong> — the app that runs the roulette
                itself. Launch it and the Settings page opens automatically in your
                browser. Log in with your Twitch account there to activate the events
                (subs, gift subs, channel points, etc.) — without logging in, nothing on
                Twitch will trigger a roll. The app runs locally on your own machine, at{' '}
                <code>localhost:7770</code>.
              </li>
            </ol>
          </section>

          <section className="set-section">
            <h2 className="set-heading">What Is This?</h2>

            <p>
              A Twitch-powered roulette that reacts live to what happens on stream:
              channel point redemptions, bits power-ups, subs, and gift subs. Depending on
              what triggered it, the roulette either:
            </p>

            <ul className="about-list">
              <li>rolls <strong>loot</strong> — a weapon, a helmet, and/or an armor set for the streamer,</li>
              <li>
                <strong>spawns</strong> something in-game — a pack of mutants or a hostile
                squad near the streamer, or
              </li>
              <li>
                triggers a <strong>positive effect</strong> — temporary invulnerability, a
                cash drop, free ammo, or a medical item.
              </li>
            </ul>

            <p>
              Every roll plays out live on stream as an animated slot-machine overlay with
              spinning reels, sound, and sparkle effects before landing on a result.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">How To Trigger A Roll</h2>

            <h3 className="set-subheading">1. Channel Points</h3>
            <p>Four redeemable rewards, each costing channel points:</p>
            <ul className="about-list">
              <li><code>[SPIN] Spawn Squads</code> — spawns a hostile squad</li>
              <li><code>[SPIN] Spawn Mutants</code> — spawns a mutant pack</li>
              <li><code>[SPIN] Loot Roll</code> — rolls gear for the streamer</li>
              <li><code>[SPIN] Positive Effects</code> — rolls a random positive effect</li>
            </ul>

            <h3 className="set-subheading">2. Bits Power-Ups</h3>
            <p>
              The same four rolls, but funded by bit cheers instead of channel points (the
              streamer sets the bits price on Twitch&apos;s side). A bits power-up always
              rolls the best case: the max count of 3 for Spawn Squads/Mutants and Loot
              Roll, and a guaranteed bonus wherever one can land (spawn bonuses and
              positive-effect bonuses alike). See the Bits Power-Ups guide, linked from
              Settings, for how to create them on Twitch.
            </p>
            <p className="set-muted">
              Note: this is a limited-time Twitch event feature, and Twitch is retiring it
              on September 18, 2026 — after that date, this trigger goes away.
            </p>

            <h3 className="set-subheading">3. Subs, Resubs &amp; Gift Subs</h3>
            <ul className="about-list">
              <li>
                A brand-new sub, a resub, or a single gifted sub has EQUAL odds (1-in-4
                each) of rolling: loot, a squad, a mutant pack, or a positive effect — with
                a random 1-3 count for loot/squad/mutant either way (Random mode).
              </li>
              <li>
                Gifting MORE THAN ONE sub at once (a &quot;gift bomb&quot;) still has those
                same 1-in-4 odds — it&apos;s not guaranteed to be a spawn or anything else.
                What changes is the SIZE and the ODDS once it lands on loot or a spawn:
                <ul className="about-list">
                  <li>
                    It always uses the maximum count of 3 instead of a random 1-3 (3 loot
                    items, or 3 independently-rolled squad/mutant groups in Random mode).
                  </li>
                  <li>
                    If it lands on a squad or mutant spawn while Count Roll mode is active,
                    that spawn is also GUARANTEED to land a bonus — Count Roll always does
                    a single roll regardless of gift size, so the &quot;always 3&quot; part
                    doesn&apos;t apply there, only the guaranteed bonus does.
                  </li>
                  <li>
                    A gift bomb landing on a positive effect still rolls normally, with the
                    effect&apos;s own regular bonus chance — the guaranteed-bonus treatment
                    is a bits-power-up-only perk.
                  </li>
                </ul>
              </li>
              <li>
                The size of the gift bomb itself (2 subs, 5 subs, 50 subs…) doesn&apos;t
                change any of this further — every gift bomb bigger than 1 gets exactly the
                same treatment, however big it is.
              </li>
            </ul>

            <h3 className="set-subheading">4. Manual</h3>
            <p>
              The streamer can also fire any roll on demand from the Settings page, for
              testing or just for fun.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">Loot Rolls</h2>
            <p>
              A loot roll spins 1 to 3 items for the streamer — any mix of a weapon, a
              helmet, and body armor. The streamer picks a difficulty/quality preset
              (Basic, Advanced, or Expert) in Settings, which controls how good the rolled
              gear can be — Expert rolls noticeably better gear than Basic.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">Positive Effects</h2>
            <p>A fourth kind of roll, picked at random among four effects:</p>
            <ul className="about-list">
              <li><strong>Immortality</strong> — temporary invulnerability for a rolled duration</li>
              <li><strong>Give Ammunition</strong> — a rolled number of ammo packs for whatever&apos;s in hand</li>
              <li><strong>Give Money</strong> — a rolled cash drop</li>
              <li>
                <strong>Medicine</strong> — a medical item (varies by difficulty tier) plus
                a secondary supply item, and a small chance of an extra bonus item
              </li>
            </ul>
            <p>
              Each effect has its own chance of landing an extra bonus on top — more
              seconds or doubled duration for Immortality, extra ammo packs for Give
              Ammunition, doubled or extra cash for Give Money, an extra medical item for
              Medicine. The streamer can enable/disable each effect, fine-tune how often
              each one is picked and how often its bonus lands, and restore everything to
              its defaults in one click — all from the Tweaking page (linked from Settings
              and the navbar).
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">Spawn Rolls — Two Modes</h2>
            <p>
              When a roll spawns mutants or a squad, it can work one of two ways. The
              streamer switches between them any time in Settings, and it affects every
              future spawn immediately.
            </p>

            <h3 className="set-subheading">Random Mode</h3>
            <p>
              The classic version. The roll independently picks 1 to 3 creature/squad
              groups (the same group can even come up more than once), each with its own
              spawn count. Simple and fast.
            </p>

            <h3 className="set-subheading">Count Roll Mode (default and recommended)</h3>
            <p>
              A more &quot;slot machine&quot; feeling version, with two separate spinning
              reels: the first rolls a NUMBER — how many are about to spawn — and the
              second rolls WHAT spawns — which mutant type or which squad. Only one type of
              thing spawns per roll (never a mix), but the count can still be as small as 1
              or fairly large, and — unlike Random mode — Count Roll spawns have a chance
              at a bonus (below).
            </p>
            <p className="set-muted">
              Note: because Count Roll always does a single &quot;what + how many&quot;
              roll, reward descriptions that mention rolling &quot;1-3&quot; are describing
              Random mode&apos;s behavior — while Count Roll is active, those same rewards
              still work, they just always produce one roll instead.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">Spawn Bonuses (Count Roll Mode Only)</h2>
            <p>
              Every Count Roll spawn has a small chance of landing a bonus on top of the
              normal result. At most one bonus can apply per roll:
            </p>
            <ul className="about-list">
              <li><strong>x2 Double Count</strong> — doubles however many were about to spawn</li>
              <li><strong>+2 Plus Two</strong> — adds 2 more to the spawn count</li>
              <li>
                <strong>Rare Tier Upgrade</strong> — instead of a normal pick, spawns
                something from the NEXT tier up (e.g. a Basic roll can spawn something
                that&apos;s normally only available at Advanced). Expert rolls upgrade
                within Expert&apos;s own rarest options, since there&apos;s no tier above
                Expert.
              </li>
            </ul>
            <p>
              By default, each bonus has a 3.3% chance per roll (about a 1-in-10 chance of
              ANY bonus landing). The streamer can turn any bonus on or off, fine-tune each
              one&apos;s exact chance as a percentage, and restore the defaults in one
              click — all from the Tweaking page, and the tweaks survive the app being
              closed and reopened. If the enabled bonuses&apos; chances add up to 100% or
              more, a bonus becomes GUARANTEED on every roll (split fairly between whichever
              bonuses are enabled, based on their relative chances).
            </p>
            <p>
              A landed bonus is impossible to miss on stream: the whole roulette glows and
              pulses gold while it plays out, a &quot;BONUS&quot; badge appears, the number
              reel shows the roll it landed on with the bonus called out (e.g. &quot;x2 (x2
              bonus)&quot;), and the final result underneath shows the true total (e.g.
              &quot;x4&quot;).
            </p>
            <p>
              Tier Upgrade specifically respects the same faction restrictions described
              below — it can never pull in Monolith, Sin, or UNISG unless the roll is
              already happening at the Expert tier.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">Difficulty Tiers: Basic / Advanced / Expert</h2>
            <p>
              Both mutant packs and hostile squads come in three tiers, switchable any time
              in Settings, affecting every spawn until changed again. Higher tiers
              generally mean stronger, tougher, and more varied enemies.
            </p>

            <h3 className="set-subheading">Mutant Packs By Tier</h3>
            <ul className="about-list">
              <li>
                <strong>Basic:</strong> Dogs, Pseudodogs, Boars, Cats, Fractures, Zombies,
                Snorks, Flesh, Lurkers, Poltergeist, Tushkano, Karlik
              </li>
              <li>
                <strong>Advanced:</strong> everything in Basic, plus Bloodsuckers, Burers,
                Chimeras, Psysuckers, Psy Dog
              </li>
              <li>
                <strong>Expert:</strong> everything in Advanced, plus Strong Chimera,
                Gigant, Controller
              </li>
            </ul>

            <h3 className="set-subheading">Hostile Squads By Tier</h3>
            <ul className="about-list">
              <li>
                <strong>Basic &amp; Advanced:</strong> Renegades, Bandits, Loners, Mercs,
                Military, Duty, Freedom, Clear Sky, Ecolog, Zombied
              </li>
              <li>
                <strong>Expert:</strong> everything above, plus Monolith, Sin, UNISG
              </li>
            </ul>
            <p>
              Monolith, Sin, and UNISG are exclusive to the Expert tier — they can never
              show up while the squad difficulty is set to Basic or Advanced, even via a
              Tier Upgrade bonus.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">Turning Off Specific Squads Or Mutants</h2>
            <p>
              The streamer can individually disable any hostile squad faction (say, never
              wanting Duty to spawn) from Settings — a disabled faction is skipped entirely
              and can never come up, in either Random or Count Roll mode, and the on/off
              state is shared between both modes (turning a squad off is a single switch,
              not a separate one per mode).
            </p>
            <p>
              There&apos;s currently no equivalent on/off switch for individual mutant
              types — the mutant roster for each tier is fixed.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">The Overlay (What Viewers See)</h2>
            <p>
              Every roll appears as an animated overlay on stream: a badge at the top shows
              who/what triggered it (Channel Points, Bits Power-up, New Sub, Resub, Gift
              Sub, or Manual) and the viewer&apos;s name, then one or two spinning reels
              play out with sound and sparkle effects before landing on the final result.
              If a bonus lands, the whole thing gets a distinct gold glow and a
              &quot;BONUS&quot; badge so it&apos;s obvious at a glance that something
              special just happened.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">A Note On Odds</h2>
            <p>
              &quot;Chance&quot; numbers above (3.3% per bonus, 1-in-4 category odds on
              subs, etc.) reflect the defaults as of this guide. Bonus chances, positive
              effect odds, and which squads are enabled can all be changed by the streamer
              at any time from Settings and the Tweaking page, so the exact odds in effect
              on stream may differ from the defaults listed here if they&apos;ve been tuned
              since.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
