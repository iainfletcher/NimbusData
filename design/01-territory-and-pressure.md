# Design Exploration 02 — Territory, Culture and War

The core idea of the game. Territory is a continuous field contested by **two
pressures that behave nothing alike**: military, which is *built*, and cultural,
which is *earned*.

The one-line version:

> **Military pressure takes land. Cultural pressure converts it.
> So the way you defend a border is by building a town people want to live in.**

---

## 1. Why this is the centre and not a sub-system

City-sims with combat almost always fail the same way: the building game and the
war game compete for the player's attention and share nothing but a map. You stop
tending your city to go fight, then come back to a city that got worse while you
were away. Two games in a trenchcoat.

Dual pressure dissolves this. **Playing the city-building game well *is* the
territorial game.** A prosperous, beautiful, well-sited town pushes its own borders
outward with no orders from you. A grim garrison town loses ground to a nicer
neighbour in peacetime. Every hour spent on the city is also an hour spent on the
map, and vice versa. Nothing has to be abandoned to do the other thing.

That's also why it earns being the lead pillar: it's the mechanic that makes this
game *one game*.

---

## 2. The two fields

Territory is continuous — a field over the map, not a set of claimed tiles. Borders
sit where opposing pressure balances, so they are smooth living contours that
breathe rather than a stack of hexes flipping colour.

| | **Military** | **Cultural** |
|---|---|---|
| Source | Towers, keeps, garrisons — discrete points | The whole town — a distributed emission |
| How you get it | **Built.** Place a tower, done | **Earned.** A byproduct of the town being good |
| Onset | Immediate on completion | Slow — accumulates over a long time |
| Falloff | Steep. Hard edge, tight radius | Gentle. Soft edge, long tail |
| If the source is lost | Collapses **instantly** | Lingers for a long time (high hysteresis) |
| Upkeep | Expensive and continuous — soldiers eat | None. It's a side effect of playing well |
| What it does to land | **Holds** it | **Converts** it |
| Can it take defended ground? | Yes — the only thing that can | No |
| Character | Seize | Keep |

The asymmetry is the whole design. Neither is a strictly better version of the
other, and neither can do the other's job.

### What emits cultural pressure

Critically: **there is no "culture building."** A lever you build to produce culture
would be exactly the kind of bolted-on system to avoid. Cultural pressure is the
*output of the city game*, radiated by ordinary buildings:

- **Prosperity** — goods actually flowing, people actually fed.
- **Quality** — a building's evolution state (see `00`, Pillar B). A flourishing,
  densified townhouse emits strongly. **A slum emits nothing, or negative.**
- **Age and history** — long-established districts emit more. (Ties directly to
  Pillar E: the city remembers, and its memory is worth territory.)
- **Amenity** — markets, taverns, temples, gardens. You place these for your own
  citizens' sake; the cultural emission is a consequence, not the reason.
- **Occasional spikes** — festivals, a completed monument.

This closes a loop that makes decay genuinely frightening: **let a district rot and
you don't just lose the district, you lose ground.** Pillar B's visible decay
becomes territorial loss, which is a far sharper motivator than an unhappiness stat.

---

## 3. Two states of territory: held vs. integrated

This is where the two fields produce a real strategic structure.

**Held** — inside your military contour, cultural pressure below threshold.

- Continuous garrison upkeep.
- Unrest. Production penalty.
- **No in-migration**, and **buildings do not evolve or densify** — they may decay.
- Remove the garrison and you lose it immediately.

**Integrated** — cultural pressure above threshold.

- Full function: growth, migration, evolution, densification.
- Genuinely yours. **The garrison can be withdrawn and the land stays.**

The conversion from held to integrated takes time *and* requires a genuinely good
town nearby to radiate into it. You cannot buy it, and you cannot rush it.

**This is the anti-snowball mechanism, and it's structural rather than arbitrary.**
Blitzing gets you a wide, sullen, expensive empire that produces almost nothing and
bleeds upkeep. Growth has a natural speed limit that comes from the fiction rather
than from a rule the player has to be told.

### The supply rule that makes it bite

From `00`: warbands outside your territory drain supply and weaken, so your reach
is set by your economy.

**Refinement: supply extends from *integrated* territory only, never from held.**

You therefore cannot chain conquests. Take a province, and to push further you must
first make it genuinely yours — which means making it a decent place to live. The
conqueror is forced to become a city-builder between wars, by the mechanics rather
than by scolding. Expansion becomes a rhythm: seize, integrate, seize, integrate.

---

## 4. Culture flows both ways — the peacetime threat

The mechanic's best property is that it is not a tool you own. It's a field, and
your neighbours are in it.

If a rival's beautiful, prosperous city sits near your grim frontier town, **their
culture pushes into your land.** Your citizens drift. Your buildings stop
flourishing. Your border quietly recedes — in peacetime, with no war declared and
nobody attacking anything.

You can answer this with soldiers, but only in the shallow way: garrisoning holds
the ground while reverting it to *held*, so you pay upkeep forever for land that
produces little and would leave the moment you looked away.

**The real answer is to make your own town better.** Defence by city-building.

Two things this buys:

1. **A pacifist has a real game.** Genuine expansion path, genuine stakes, genuine
   threat — without ever raising a warband.
2. **Neglect has teeth.** A player who lets the frontier rot is punished
   territorially and *visibly*, without a single warning popup or red number.

---

## 5. Situations this produces

These are the emergent states worth designing toward — the ones that would make
good stories:

**The gilded cage.** You hold a province militarily for years and never integrate
it. It never pays for itself and never will. Do you finally invest in it, or cut it
loose?

**The drift.** You lose land in peacetime because a district rotted while you were
looking elsewhere. Entirely your fault, entirely visible in hindsight, no combat
involved.

**The bought frontier.** You deliberately build a beautiful town on a contested
border as an act of aggression. Culture as a weapon, no army required. Your
neighbour can see exactly what you're doing and can only answer in kind.

**Inherited pride.** You conquer a town *nicer than yours*. It keeps radiating its
own culture, resists integration hard, and may culturally re-convert its
surroundings back toward its origin — you've swallowed something that's still
pushing outward from inside you. **Conquering above your weight is genuinely
dangerous**, which is thematically excellent and, as far as I know, novel.

---

## 6. Visual language (serving the no-numbers experiment)

The two fields are the strongest argument that Pillar A can actually work, because
they are naturally legible:

- **Military pressure**: a hard, bright, banner-coloured edge. A drawn line.
- **Cultural pressure**: a soft warm haze with a long gradient. Light spilling out
  of a settlement.
- **Held but not integrated**: the hard line encloses land that your warm haze
  *does not fill*. It reads instantly and wordlessly as "we're standing here, but
  this isn't ours."
- **Contested culture**: two hazes visibly interpenetrating, and you can see which
  is winning by watching where the mixing line sits.
- **Emission attribution**: a flourishing district visibly glows; a rotting one
  visibly doesn't. You can see *which of your buildings* is buying you territory.

All of it works at a glance, with no numbers, and it's beautiful by construction.

---

## 7. Risks

1. **Cultural pressure could feel passive** — borders moving for reasons the player
   can't attribute. The emission-glow rendering above is the mitigation, and it
   needs to be in the very first prototype, not added later.
2. **Snowball risk.** A strong player's culture could win everywhere. Candidate
   brakes: distance falloff, hysteresis cutting both ways, and **saturation** — so
   a merely good town competes respectably with a perfect one, and there are
   diminishing returns on gilding.
3. **Two overlapping fields may be hard to read at once.** Genuine unknown.
   Prototype question, and a real threat to Pillar A.
4. **Does culture undercut the point of fighting?** It shouldn't: culture is slow
   and **cannot take ground that is actively defended**. Military is the only way
   to take a held place, and the only way to take anything *now*. Speed and
   contested ground are war's exclusive domain.
5. **Integration could become a waiting game** — nothing to do but let the meter
   fill. It must be something you *actively drive* by building well nearby, not
   something you wait out.

---

## 8. Built — what the first test actually showed

Cultural pressure is implemented (`territory.ts`), spreading geodesically like the
character field so it runs along roads and stops at ridges and water. Claim is
integrated slowly toward the pressure balance, which is the stickiness §2 asks
for. Military pressure is not built; this was the no-combat test §9 specifies.

**The experiment.** Two towns of **47 buildings each**, same mix of types, on the
same map. The player's is laid out along roads in coherent quarters; the rival's
is the same buildings jumbled together with no road and no quarter. If culture
came from size, they would draw.

**First result — the thesis was much weaker than this document claimed:**

| | Coherence | Cultural output | Territory |
|---|---|---|---|
| Ordered town | 78% | 18 | 3,125 |
| Jumbled town | 66% | 15 | 2,718 |

A fifth more output and a seventh more ground. This document says a muddled
district "radiates almost nothing"; in practice it radiated **83%** of what the
ordered one did.

**Why, and it is worth knowing: it is genuinely hard to build an incoherent
town.** Character concentrates locally almost whatever the layout — the more so
with geodesic spread, which channels rather than blends — so nearly everything
clears the coherence threshold. Even deliberate jumbling only cost 12 points.
**Coherence is a much weaker discriminator than §2 assumes.**

**Making it decisive required tuning, not more simulation.** Applying coherence
*steeply* rather than linearly:

| Response | Territory | Verdict |
|---|---|---|
| Linear | 3,125 v 2,718 | Too weak to read as a mechanic |
| Squared | 2,014 v 322 | A rout — and it shrank everyone's reach so far the map went unclaimed |
| **Power 1.6, reach rebalanced** | **5,105 v 2,240** | Clear advantage, loser still on the map |

**Verdict: the pillar holds, with an important caveat.** A well-ordered town does
push its border into a matched jumble, with no combat, and it is legible on the
map. But the effect is **tuned into existence rather than emergent** — the
response curve is doing the work, not the simulation. That is a legitimate design
decision, and it should be recorded as one rather than presented as something the
model produced on its own.

**What this implies for the design.** If coherence alone barely separates towns,
it probably should not carry the whole load. Age (§Antique), size, and amenity
mix are all candidates to share it, and would each be more robust than a
quantity that saturates as easily as this one does.

## 9. First thing to prototype

The smallest build that tests the core claim: **one map, two settlements, both
fields, no combat at all.**

If watching a well-built town silently push its border into a neglected one is
satisfying and legible — with no war, no units, and no numbers — then the pillar
holds and everything else can be built on it. If that isn't fun, nothing further
up the stack will save it.

## 10. Built — the military half, and what testing it actually found

The other half of the lead pillar now exists (`src/sim/military.ts`). Everything
in §2's table is implemented as a genuine opposite of the cultural field: sources
are discrete and built, onset is immediate, falloff is a hard edge, upkeep is
food per tick forever, and the whole field is recomputed rather than settled — so
losing the last tower on a frontier loses the frontier the same tick.

With it: held vs integrated (§3), supply from integrated ground only, warbands
that march, starve, fight and besiege, buildings that change hands by cultural
drift (§2's "converts"), and a rival that plays all of it back at you.

### The methodological change that matters more than any of it

`src/sim` has always been engine-agnostic by contract, and nobody had collected
the payoff: **it runs in plain Node with no browser and no Pixi.** So
`npm run trial` now states each claim in this document, runs it, and prints what
happened. Eleven of them.

That is a different standard of evidence from a screenshot, and it earned its
keep immediately — **six of the eleven failed the first time, and three of those
were the design being wrong rather than the code.**

### What the trials found

**1. The rival fortified on a vibe, and it was unbeatable.** A watchtower emits
`martial` strongly, so the moment one exists the dominant character around it is
martial — and the rival's rule of *reinforce the dominant character* then means
build more fortifications, which emit more martial. One tower snowballed into a
fortress town that out-garrisoned a besieging column indefinitely, for free. The
fix is a rule worth keeping: **the rival fortifies on a policy, never on a
vibe.** Walls come from a rationed budget; everything else follows the field.

**2. "Held" turned out to be two states, not one.** §3 says held ground does not
evolve. But a keep *radiates martial culture as well as holding ground*, so
within a couple of hundred ticks its own contour stops being merely held and
becomes ground its owner has genuinely integrated. A foreign building standing
there is then on integrated ground — and would have started flourishing again.
The rule had to be restated: **a building only flourishes on ground its own side
has made theirs.** That covers held ground, enemy ground and contested ground in
one line, and open country still grows normally, which is where every town
starts.

**3. Military collapses instantly; culture does not, and I conflated them.** The
first version of the collapse trial measured total territory and failed: pulling
the tower down dropped the military hold from 2,717 cells to **zero in a single
update**, exactly as §2 demands, while the cultural claim the tower had built up
lingered — also exactly as §2 demands. Both behaviours were right. The
*measurement* was wrong, and it is worth recording that the hysteresis asymmetry
is strong enough to catch out the person who wrote it.

**4. A garrison's reach is geodesic, so a keep's radius is a terrain decision.**
Nominal reach is 235m of open ground; on broken ground it shrinks to well under a
hundred. A trial that placed a hamlet 60m from a keep found most of it standing
*outside* the contour. This is good — siting a fortress is a question about the
land, like siting a mill — but it means nominal radii mislead.

### The numbers

| Claim | Measured |
|---|---|
| The gilded cage (§3, §5) | Producers on open ground yield **1.164/tick**; the same three inside a hostile contour yield **0.694** |
| Neglect has a territorial cost (§4) | A player who stops building watches the rival's share of claimed ground go **38% → 46%** over 900 ticks |
| Instant collapse (§2) | **2,717 held cells → 0** in one update |
| Combat | The stronger column survives at 0.55 strength; the weaker disbands |

### §7 risk 3 — "two overlapping fields may be hard to read" — answered

This was flagged as a genuine unknown and a real threat to Pillar A. The answer
is that it works, and **the reason it works is not hue.**

The first attempt drew the military contour by filling boundary cells. An 8m cell
painted solid reads as a wide ribbon laid over the landscape — close enough to a
road to be confusing — and it swamped the very haze it was supposed to be
distinguishable from. Stroking the actual boundary between cells fixed it
completely.

> **Culture never draws a line; the military never draws a gradient.** The two
> fields are told apart by *edge*, not by colour, which is what lets them belong
> to the same side and still be read separately where they overlap.

With that, §6's key reading works wordlessly: a bright drawn contour enclosing
ground the warm haze does not fill says *we are standing here, but this isn't
ours*. Hatching inside it makes the occupation explicit rather than inferred, and
where two contours meet they turn an alarm colour, because that is a battle line
and not a border.

Architecture followed the same principle: fortifications are the only silhouette
in the game with a **notched** top. A keep that finished in a spire — which is
what the first version drew, because every previous landmark was a church — reads
as a cathedral.

### One thing that fell out rather than being designed

Warbands route by flooding the same cost field culture travels on. Roads are
cheap in that field, so **armies march on roads** without a line of code saying
so. That was not intended and it is the right behaviour.

## 11. Built — what a column *is*, and where it fights

The limit recorded below as "combat is one rule" turned out to be worse than the
wording admits, and worth fixing before anything else in this pillar.

Attrition was **symmetric**: `strength × rate` in both directions. So a fight
was decided the instant the two columns touched — arrive with more and win,
arrive with less and lose, and nothing that happened in between mattered.
Combat was the one system in this game with **no spatial decision in it**, which
is a strange property for the lead pillar to have, and it is thinner than
Polytopia — the game the brief says to be more developed than.

The obvious fix is unit types with a roster, and it is wrong here for exactly
the reason a research tree was wrong for the ages: a picker is a menu, and menus
are admin. So:

> **What a column is, is decided by where it was raised. Where it fights decides
> how it goes.**

### A column takes the character of the quarter that raised it

Seven tempers, one per character, four numbers each — bite, guard, pace, and the
strength at which it breaks. A keep among the foundries raises **an armoured
column**: fewer men, better arms, slow. One out on the farms raises **a levy**:
numerous, willing, no good in a stand-up fight. A garrison quarter raises
**regulars**. A devout one raises **sworn men**, who do not break at all.

There is nothing to choose at muster time, and that is the point: the choice was
made hours earlier when you decided what that part of your town was going to
*be*. It is the same decision the rest of the game is played in, cashed out
somewhere new.

Measured, from the same button on the same map: among the foundries, *an
armoured column, musters at 0.90*; out on the farms, *a levy, musters at 1.30*.

### The third time the same bug has been caught

The first implementation read the character field at the keep. A keep emits
`martial` at 1.8 over 140 metres, so it drowns out whatever it is standing in,
and **every column came out as regulars, everywhere, always** — the building
reading its own presence and calling it the character of the town. One trial run
caught it.

That is now three times, in three systems: the rival fortifying because a
watchtower made the ground feel martial (§10); a keep's own contour counting as
ground its owner had integrated (§10); and this. The rule is worth stating once:

> **A fortification never reads its own presence as the character of the place it
> is standing in.**

The tally is taken from the buildings around the keep with military excluded,
which is also the more honest question — a garrison quarter is martial because
of the barrack rows *around* the keep, and a lone tower in a field of wheat
raises farmers.

### The high ground

The only thing that makes *where* a battle happens a decision rather than an
accident, and the only terrain feature the player can already see with no
interface at all. A column fighting uphill deals less and takes more, capped so
that it never beats arriving with twice the men.

The rate is set against the ground the generator actually makes, not a round
number: a column can only stand where the terrain varies by under four metres
across it, so two columns in contact are realistically five to ten metres apart
in height. Measured, two identical columns:

- **Level ground: neither left standing.** They destroy each other.
- **Seven metres uphill: theirs left standing at 0.41.** One walks away.

A seven-metre rise decides a battle that was otherwise a mutual annihilation.
That is the right magnitude — decisive, and still losable to numbers.

### Deployment answers before you commit, not after

A column ordered outside supply starves, and you used to find that out by
watching the pennant droop a minute after committing. The march line now answers
it while you are still deciding: gold to ground that will feed them, grey and
crossed to ground that will not. Being told after the column has starved is not
an answer, it is an autopsy.

### And the bug the levy exposed

Recovery was capped at 1 for everybody. A levy musters at 1.3 — being numerous
is the *whole* of what a levy is — so the cap silently deleted its only
advantage on its first supplied tick. Capped at what the column musters at now.

### Honest limits

- **Combat is still one rule**, and now the rule has ground and character in it.
  Columns in contact wear each other down in proportion to the other's strength,
  modified by what each is and who has the hill. There is still no manoeuvre
  inside a battle, no flanking and no formation, and that is deliberate: the
  decisions are meant to be *where you built*, *what you built there*, *whether
  your ground will feed them* and *where you choose to meet*. Whether that is
  enough game is untested by anything but me.
- **The rival's soldiers are not clever.** It musters on a fixed clock and marches
  at whatever of yours is nearest. Deliberate: a cleverer opponent would make a
  moving border tell you about the AI rather than about your town.
- **§8's warning still stands.** Coherence carries almost the whole cultural load,
  and it is a weak discriminator. Age, size and amenity mix should share it. The
  military half does not fix that and was never going to.
- **No human has played this.** Everything above is measurement and judgement.

