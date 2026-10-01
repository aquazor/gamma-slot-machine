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

            <p>
              One app, does both jobs. Launch <strong>GAMMA Slot Machine.exe</strong> and
              the Settings page opens automatically in your browser, running locally at{' '}
              <code>localhost:7770</code>.
            </p>

            <ol className="about-list">
              <li>
                <strong>Install the mod</strong> — open the <strong>Mod install</strong>{' '}
                section in Settings and click <strong>Install</strong>. It copies itself
                straight into your Anomaly folder, so it works whether you launch through
                the Anomaly Launcher or the game exe directly. (Installing it by hand with
                MO2 into <code>GAMMA\mods</code> still works too, if you&apos;d rather do
                it that way.)
              </li>
              <li>
                <strong>Connect Twitch</strong> — log in with your Twitch account from
                Settings to activate the events (subs, gift subs, channel points, etc.) —
                without logging in, nothing on Twitch will trigger a roll.
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
              <li>
                rolls <strong>loot</strong> — a weapon, a helmet, and/or an armor set for
                the streamer,
              </li>
              <li>
                <strong>spawns</strong> something in-game — a pack of mutants or a hostile
                squad near the streamer, or
              </li>
              <li>
                triggers a <strong>positive effect</strong> — temporary invulnerability, a
                cash drop, free ammo, a medical item, or food and water, or
              </li>
              <li>
                triggers a <strong>negative effect</strong> — a dropped weapon, lost
                money, broken gear, a time warp, getting drunk, or a junk item.
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
            <p>Five redeemable rewards, each costing channel points:</p>
            <ul className="about-list">
              <li>
                <code>[SPIN] Spawn Squads</code> — spawns a hostile squad
              </li>
              <li>
                <code>[SPIN] Spawn Mutants</code> — spawns a mutant pack
              </li>
              <li>
                <code>[SPIN] Loot Roll</code> — rolls gear for the streamer
              </li>
              <li>
                <code>[SPIN] Positive Effects</code> — rolls a random positive effect
              </li>
              <li>
                <code>[SPIN] Negative Effects</code> — rolls a random negative effect
              </li>
            </ul>

            <h3 className="set-subheading">2. Bits Power-Ups</h3>
            <p>
              The same five rolls, but funded by bit cheers instead of channel points (the
              streamer sets the bits price on Twitch&apos;s side). A bits power-up always
              rolls the best case: the max count of 3 for Spawn Squads/Mutants and Loot
              Roll, and a guaranteed bonus wherever one can land (spawn bonuses, positive
              effects, and negative effects alike). See the Bits Power-Ups guide, linked
              from Settings, for how to create them on Twitch.
            </p>
            <h3 className="set-subheading">3. Subs, Resubs &amp; Gift Subs</h3>
            <ul className="about-list">
              <li>
                A brand-new sub, a resub, or a single gifted sub has EQUAL odds (1-in-5
                each) of rolling: loot, a squad, a mutant pack, a positive effect, or a
                negative effect — with a random 1-3 count for loot either way.
              </li>
              <li>
                Gifting MORE THAN ONE sub at once (a &quot;gift bomb&quot;) still has
                those same 1-in-5 odds — it&apos;s not guaranteed to be a spawn or
                anything else. What changes is the SIZE and the ODDS once it lands:
                <ul className="about-list">
                  <li>Loot always uses the maximum count of 3 instead of a random 1-3.</li>
                  <li>
                    A squad or mutant spawn is also GUARANTEED to land a bonus instead of
                    the normal per-roll chance.
                  </li>
                  <li>
                    A positive or negative effect is also GUARANTEED to land its own
                    bonus, wherever that effect has one — otherwise it rolls normally.
                  </li>
                </ul>
              </li>
              <li>
                The size of the gift bomb itself (2 subs, 5 subs, 50 subs…) doesn&apos;t
                change any of this further — every gift bomb bigger than 1 gets exactly
                the same treatment, however big it is.
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
            <p>One kind of roll, picked at random among five effects:</p>
            <ul className="about-list">
              <li>
                <strong>Immortality</strong> — temporary invulnerability for a rolled
                duration
              </li>
              <li>
                <strong>Give Ammunition</strong> — a rolled number of ammo packs for
                whatever&apos;s in hand
              </li>
              <li>
                <strong>Give Money</strong> — a rolled cash drop
              </li>
              <li>
                <strong>Medicine</strong> — a medical item (varies by difficulty tier)
                plus a secondary supply item, and a small chance of an extra bonus item
              </li>
              <li>
                <strong>Food &amp; Water</strong> — a random meal plus a random drink,
                with a chance of a premium pair instead
              </li>
            </ul>
            <p>
              Each effect has its own chance of landing an extra bonus on top — more
              seconds or doubled duration for Immortality, extra ammo packs for Give
              Ammunition, doubled or extra cash for Give Money, an extra medical item for
              Medicine, a premium food/drink pair for Food &amp; Water. The streamer can
              enable/disable each effect, fine-tune how often each one is picked and how
              often its bonus lands, and restore everything to its defaults in one click —
              all from the Tweaking page (linked from Settings and the navbar).
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">Spawn Rolls</h2>
            <p>
              A spawn roll (mutants or a hostile squad) is two separate spinning reels: the
              first rolls a NUMBER — how many are about to spawn — and the second rolls
              WHAT spawns — which mutant type or which squad. Only one type of thing
              spawns per roll (never a mix), but the count can still be as small as 1 or
              fairly large, and every spawn roll has a chance at a bonus (below).
            </p>
            <p>
              The streamer can switch the squad/mutant roster itself between{' '}
              <strong>Count Roll</strong> and <strong>Count Roll (LABS)</strong> in Settings
              — same mechanic either way, just a different roster. The LABS roster makes
              Monolith, Sin, and UNISG reachable at every difficulty tier instead of Expert
              only, and can trim or rebalance which mutants/squads show up independently of
              the normal roster. Its own spawn bonuses (below) are tuned separately too.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">Spawn Bonuses</h2>
            <p>
              Every spawn roll has a small chance of landing a bonus on top of the normal
              result. At most one bonus can apply per roll:
            </p>
            <ul className="about-list">
              <li>
                <strong>x2 Double Count</strong> — doubles however many were about to
                spawn
              </li>
              <li>
                <strong>+1 Plus One</strong> — adds 1 more to the spawn count
              </li>
              <li>
                <strong>+2 Plus Two</strong> — adds 2 more to the spawn count
              </li>
              <li>
                <strong>Rare Tier Upgrade</strong> — instead of a normal pick, spawns
                something from the NEXT tier up (e.g. a Basic roll can spawn something
                that&apos;s normally only available at Advanced). Expert rolls upgrade
                within Expert&apos;s own rarest options, since there&apos;s no tier above
                Expert. Mutant packs only — hostile squads don&apos;t use this one.
              </li>
            </ul>
            <p>
              By default, each bonus has a 2.5% chance per roll (about a 1-in-10 chance of
              ANY bonus landing). Exactly which bonuses are active can vary by category and
              tier — see the Tweaking page for what&apos;s actually enabled right now. The
              streamer can turn any bonus on or off, fine-tune
              each one&apos;s exact chance as a percentage, and restore the defaults in
              one click — all from the Tweaking page, and the tweaks survive the app being
              closed and reopened. If the enabled bonuses&apos; chances add up to 100% or
              more, a bonus becomes GUARANTEED on every roll (split fairly between
              whichever bonuses are enabled, based on their relative chances).
            </p>
            <p>
              A landed bonus is impossible to miss on stream: the whole roulette glows and
              pulses gold while it plays out, a &quot;BONUS&quot; badge appears, the
              number reel shows the roll it landed on with the bonus called out (e.g.
              &quot;x2 (x2 bonus)&quot;), and the final result underneath shows the true
              total (e.g. &quot;x4&quot;).
            </p>
            <p>
              Tier Upgrade specifically respects the same faction restrictions described
              below — on the normal roster, it can never pull in Monolith, Sin, or UNISG
              unless the roll is already happening at the Expert tier. The LABS roster has
              no such restriction, since those factions are available at every tier there
              to begin with.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">Difficulty Tiers: Basic / Advanced / Expert</h2>
            <p>
              Both mutant packs and hostile squads come in three tiers, switchable any
              time in Settings, affecting every spawn until changed again. Higher tiers
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
              On the normal roster, Monolith, Sin, and UNISG are exclusive to the Expert
              tier — they can never show up while the squad difficulty is set to Basic or
              Advanced, even via a Tier Upgrade bonus. Switching to the{' '}
              <strong>Count Roll (LABS)</strong> roster (see Spawn Rolls above) makes all
              three reachable at every tier instead.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">Turning Off Specific Squads Or Mutants</h2>
            <p>
              The streamer can individually disable any hostile squad faction (say, never
              wanting Duty to spawn) from Settings — a disabled faction is skipped
              entirely and can never come up.
            </p>
            <p>
              There&apos;s currently no equivalent on/off switch for individual mutant
              types — the mutant roster for each tier is fixed.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">The Overlay (What Viewers See)</h2>
            <p>
              Every roll appears as an animated overlay on stream: a badge at the top
              shows who/what triggered it (Channel Points, Bits Power-up, New Sub, Resub,
              Gift Sub, or Manual) and the viewer&apos;s name, then one or two spinning
              reels play out with sound and sparkle effects before landing on the final
              result. If a bonus lands, the whole thing gets a distinct gold glow and a
              &quot;BONUS&quot; badge so it&apos;s obvious at a glance that something
              special just happened.
            </p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">A Note On Odds</h2>
            <p>
              &quot;Chance&quot; numbers above (2.5% per bonus, 1-in-5 category odds on
              subs, etc.) reflect the defaults as of this guide. Bonus chances, positive
              effect odds, and which squads are enabled can all be changed by the streamer
              at any time from Settings and the Tweaking page, so the exact odds in effect
              on stream may differ from the defaults listed here if they&apos;ve been
              tuned since.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
