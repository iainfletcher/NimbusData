# Design Exploration 01 — Taste Profile & Mechanic Space

Status: thinking document, partially resolved. Axes are laid out honestly with a
recommendation; decisions taken so far are recorded below.

## Decisions taken

1. **Authorship — you place everything, the town evolves it.** Not zoning, not
   accretion. The player composes; time weathers, densifies and elaborates. See
   Axis 1 (Option D) and Pillar B.
2. **Time — real-time with pause.** No seasonal turn gate. Seasons survive as
   cycle and flavour, not as decision boundaries. See Axis 6.
3. **Territory — dual pressure: military *and* cultural.** This is now the core
   idea of the game, not a sub-system of combat. Deep dive in
   `01-territory-and-pressure.md`. See Axis 4.
4. **UI — no-numbers is an open experiment, not a commitment.** Build visual-only
   first, admit numbers only where it demonstrably breaks. See Pillar A.

---

## Part 1 — What the reference games actually are

It's worth being precise about *which part* of each reference is the good part,
because in every case the thing that's loved and the thing that's disliked live in
the same system.

### The Settlers (I/II)

The famous part is the production chain. That is **not** the good part.

The good part is that the economy is **physical, spatial, and watchable**. A plank
is an object. A guy picks it up. He walks it down a road. You can stand and watch
timber move from the forest to the building site, and you understand your whole
economy by looking at it. Placement matters because distance is real.

The bad part — the part that becomes "autistic" at scale — is the same system
viewed as an optimisation problem: carrier density per road segment, flag
congestion, transport priority sliders, computing how many farms feed how many
mills. Anno and Factorio are what happens when you take Settlers' economy and
optimise for the optimisers.

**Extract:** physicality and legibility. **Discard:** throughput management.

### SimCity (classic / 2000)

The good part is that **you don't build the city, you make conditions and the city
happens.** You zone, and a skyline appears that you didn't author but did cause.
The surprise is the product. It's a gardening game.

The bad part is the accounting layer: tax rates, budget sliders, ordinance
micro-tuning, and later the traffic simulation becoming a job.

**Extract:** emergence, "I caused this but didn't draw it." **Discard:** the
spreadsheet under the toy.

### Theme Park

The good part is that **the agents visibly want things.** A guest is thirsty →
walks to a drink stall → is now happy. You debug your park by following one person
around. It's funny and it's transparent.

The bad part is famously the negotiation minigames — staff salary haggling, supply
contract negotiation — bolted-on chores with no relationship to the fun.

**Extract:** legible agent desire as the feedback channel. **Discard:** admin.

### Polytopia

The good part is **compression**. Tiny tech tree, tiny turn count, no fiddle, every
decision matters. Nothing is maintenance.

The stated limit is that it's *thin* — "something more developed."

**Extract:** decision density, zero maintenance. **The open question:** what does
"more developed" mean if it doesn't mean "more systems"? (See Part 4.)

---

## Part 2 — The unifying thesis

Across all four, the loved parts share a property and the disliked parts share the
opposite one:

> **Loved: systems that are legible and alive.**
> **Disliked: systems that are opaque and demanding.**

- *Legible* — you can tell what's happening and why by **looking at it**, not by
  opening a panel.
- *Alive* — it keeps running and changing without you touching it.
- *Demanding* — it punishes you for not doing arithmetic or not performing routine
  maintenance.

This gives a usable north star, and it's sharp enough to reject things:

> **Every system must be readable at a glance and must run without you. The
> player's job is to make decisions, never to perform maintenance.**

Note what this does *not* say. It doesn't say "simple." A system can be deep,
surprising, and hard to master while still being legible and self-running. That
distinction is the whole design.

**A useful test to apply to any proposed mechanic:** *if the player ignores this
for ten minutes, is the result "something interesting happened" or "a chore piled
up"?* Chores fail the test.

---

## Part 3 — The mechanic axes

Each axis gives the realistic options, the trade, and a recommendation.

### Axis 1 — Do you place buildings, or zone them?

| Option | Feel | Cost |
|---|---|---|
| A. Place everything (Settlers) | Total authorship, satisfying | No emergence, no surprise; large cities become tedious placement |
| B. Zone everything (SimCity) | Pure gardening, great surprise | Weak spatial decisions, and zoning UI is itself a chore |
| C. Split vocabulary | Author the skeleton, watch the flesh | Less control over the final look |
| D. **Author it, it evolves** ✅ | You compose; time elaborates | Needs strict rules so evolution doesn't undermine authorship |

**DECIDED: D.** The player places **every** building, housing included. The town
then changes what you placed, over time, without asking:

- **Ageing.** Buildings acquire patina, patching, character. A place looks its age.
- **Densification.** A well-sited cottage becomes a townhouse, then a terrace, as
  the area thrives. You didn't request it; conditions caused it.
- **Decay.** A badly-sited building degrades — grimy, shuttered, eventually a slum.
- **Renewal.** The town replaces derelict buildings on its own, sometimes with
  something different from what stood there.
- **Infill.** Side streets, yards, sheds, walls and alleys appear *between* your
  placed buildings — connective tissue you never drew.

The feel: **you are an architect, and time is your collaborator.** At hour five the
town is recognisably your composition — weathered, denser, and textured in ways you
didn't author.

**The rule that protects authorship:** *evolution elaborates the plan and never
overrides it.* Nothing you placed is deleted, moved, or repurposed against your
intent. The town develops your work; it does not edit it. Break this rule and the
whole feel collapses into frustration.

**The important consequence — building evolution is the scoring system, and it is
visible.** Since you now place housing yourself, siting has to *matter*: proximity
to work, to amenity, to noise, to a view. Good siting visibly flourishes; poor
siting visibly rots. So the town **shows you where you placed well** without a
single number, and a mature town is a legible record of your judgement. This
replaces the readout that Option C would have given, and arguably beats it — it
grades your decisions rather than merely reflecting them.

### Axis 2 — How do goods move?

This is the most important axis, because it's exactly where Settlers becomes the
thing you don't want.

| Option | Feel | Cost |
|---|---|---|
| A. Physical carriers, simulated (Settlers) | Beautiful, alive | Congestion, jams, routing — the trap |
| B. Abstract global pool (SimCity/Polytopia) | Zero friction | Zero soul; placement stops mattering |
| C. **Adjacency-structural, carrier-decorative** | Looks like Settlers, behaves like nothing | Needs care to keep placement meaningful |

**Recommendation: C**, and this is probably the single most important call in the
document.

Split what carriers *look like* from what carriers *do*:

- **Structure = catchment.** Every building projects a visible radius. Overlapping
  catchments connect automatically. Goods flow along those connections by rule.
  Your logistics decision is **placement adjacency** — never route-building.
- **Decoration = carriers.** Little guys walk the goods along, visibly. They are
  pure feedback. **They cannot jam, queue, or bottleneck.** If you delete every
  carrier animation the simulation is unchanged.

You keep the entire pleasure of Settlers — "put the sawmill near the forest,"
watch the timber walk — and you delete every failure mode that made it a job.

Roads then have a clean, non-fiddly purpose: **a road extends a building's
catchment.** Roads are reach, not throughput. So road-laying is still a real
spatial decision ("I want to connect that ore vein") with no network optimisation
underneath.

**Free legibility win:** render each connection as a *flow* whose visible thickness
is its throughput. A starved chain is a visibly thin stream. That is the entire
debugging interface, it needs no numbers, and it's pretty.

### Axis 3 — How deep are production chains?

Settlers II runs ~5 deep for weapons. Anno is worse. Polytopia has none.

**Recommendation: hard cap of 3 nodes,** and every chain must terminate in
something **you can see in the city** — a building being built, a citizen eating, a
warband being equipped. No abstract intermediate goods that exist only to be inputs
to other abstract intermediate goods.

Rough shape:
- Forest → Sawmill → **Timber** (visible: construction)
- Ore → Smelter → **Tools** (visible: build speed, equipment)
- Fields → Bakery → **Food** (visible: citizens eating, growth)

**Critical rule — self-throttling production.** A building slows when its output
has nowhere to go and speeds up when demand appears. Consequences:

- Over-building is *wasteful* but never *broken*.
- Under-building is *visible* (thin flow) rather than *discovered* (a panel).
- **The ratio math disappears entirely.** There is never a correct number of farms
  to compute. This kills the single most "autistic" mechanic in the genre.

**Buildings express their own state posturally** — a starved sawmill sits idle and
looks it; a thriving one is busy and loud. You should never open a panel to learn a
building is unhappy.

### Axis 4 — Territory and combat

You want basic combat for territory expansion. The classic failure here is that
combat and city-building compete for attention and the game becomes two games
sharing a map badly.

| Option | Feel | Cost |
|---|---|---|
| A. Settlers garrisons | Spatial, slow, thematic | Combat resolution is mush |
| B. Polytopia units | Clean, tactical | Turn-based; unit micro creeps upward |
| C. Pressure field + few named warbands | Spatial *and* decisive | Novel, needs tuning |
| D. **C, with cultural pressure alongside military** ✅ | Two ways to own land | The most novel thing here; needs the two fields to behave differently |

**DECIDED: D.** This turned out to be the centre of the game rather than a combat
sub-system, so it has its own document: **`01-territory-and-pressure.md`**. Summary
here.

**Territory as a pressure field.** Territory is continuous, not tile-claimed. Every
military building projects pressure outward, decaying with distance. **The border
sits where opposing pressures balance.** Build forward and the contour bulges.
Lose a tower and it recedes. You expand by *building*, exactly like Settlers, but
the border is a smooth living contour rather than a stack of claimed hexes — a map
that visibly breathes.

**Two fields, not one.** Military pressure is *built*; cultural pressure is
*earned* by the town being good to live in. They behave nothing alike — military is
fast, hard-edged and collapses the moment the tower falls; cultural is slow, soft
and sticky, and lingers long after. **Military pressure takes land; cultural
pressure converts it.** The consequence is that the way you defend your border is
by building a nice town — which welds the city sim to the 4X layer instead of
bolting them together. Full treatment in `01`.

**War as a handful of named warbands.** You never command individual soldiers. You
raise a *warband*: one controllable unit with a strength, a banner, and a name.
Send it at a target; the engagement resolves quickly and clearly, Polytopia-style.

**Hard cap the number of simultaneous warbands — 3 to 5, permanently.** This is a
constraint, not a balance number. It structurally forbids the game from ever
becoming an RTS micro-fest, no matter how large your empire gets. Warbands gain
veterancy and history, so you get attachment instead of unit count.

Two ideas that make combat feel like part of *this* game rather than bolted on:

**1. War is a supply problem, not a micro problem.** A warband outside your
territory drains supply and weakens. It can only operate as far as your logistics
actually reach. Expansion is therefore paced by your economy automatically —
overextension is something you *feel*, not a rule you read. This welds combat to
the city-building loop instead of parking it beside it.

**2. Conquest gives you a working town, not rubble.** Take enemy territory and
their buildings keep running, with unrest. You've inherited a city with an
attitude, and integrating it is a city-building problem. The city stays the object
of play even during war — which is exactly what city-sims-with-combat normally get
wrong.

### Axis 5 — Citizens: agents or statistics?

**Recommendation: agents, few of them, with visible needs and no management UI.**

A citizen walks to the bakery because they're hungry. You never assign anyone to
anything. Theme Park's channel — follow one person around to understand your town.

Population should stay in the **hundreds, not hundreds of thousands**. Small cities
dense with life, not big cities sparse with data. That's what "little toy city"
means mechanically, and it's also what makes per-agent simulation affordable.

**The named few.** Most citizens are anonymous, but a handful become named over
time — the baker who's been there since the founding, the veteran of the border
war. They accumulate small opinions and generate small events. This gives the town
a memory and a voice at nearly zero systemic cost. It's a strong candidate answer
to "more developed than Polytopia" *without* being "more systems."

### Axis 6 — Time model

**DECIDED: real-time with generous pause.** Seasonal turn-gating is rejected —
the living, watchable economy is the point, and a boundary that stops the world
to collect decisions works against it. Pause is the decision beat, and the player
owns when it happens. Speed controls (pause / 1× / 2× / 3×) throughout.

**Seasons survive as cycle, not as gate.** Winter still raises food demand and
slows building; harvest still arrives. You get the rhythm and the flavour without
the world ever stopping to ask you something.

Two consequences that need designing around:

**1. Where do the decision beats come from?** Turn boundaries would have supplied
them free. Instead they come from *events arriving as interruptions* — a bad
harvest, a migration wave, a rival's tower going up on your line. The game
requests your attention rather than scheduling it. Pausing on an event should feel
natural, not obligatory.

**2. Real-time plus self-throttling production risks feeling idle.** With no jams
and no ratios, there's a real danger of "nothing needs doing." The answer is that
the *border* is the continuous pressure source: the cultural field drifts all the
time, so the edges of your world are always in motion even when the middle is
calm. See `01`. This is a genuine risk to watch in the first prototype.

### Axis 7 — Where does pressure come from?

A toy city with no pressure is a screensaver. But pressure must not come from
punishing arithmetic, or we're back to the thing you dislike.

**Recommendation: pressure arrives from outside and from time — never from your own
bookkeeping.** Winters. Rival expansion. Migration waves. Demands from a distant
crown. Fire, flood, a bad harvest.

You are never punished for miscalculating a ratio. You are pressured by events you
must *adapt* to. Adaptation is interesting; arithmetic is a chore.

#### Built — the first two sources of pressure

Both halves of that recommendation now exist, and they are deliberately the two
that come from *outside* and from *time* rather than from a sum.

**Time: a seasonal clock** (`src/sim/calendar.ts`). Four seasons of equal length,
each a set of three multipliers — harvest, labour, appetite. Autumn is the reason
a town survives; winter takes more than it gives, slows every quarry and sawmill
to just over half, and makes everyone hungrier, *every year, whatever you do*. It
is a cycle, never a gate: nothing stops to collect a decision, and there is no
sum to get wrong. You either carried a surplus in or you did not.

**Outside: a rival that grows** (`src/sim/rival.ts`). Until now the rival was a
fixed jumble — it could lose ground but never take any, so neglecting your own
town cost you nothing, and there is no game in that. It now builds on a timer,
picks an anchor near contested ground, pushes *toward the frontier* so pressure
arrives from a visible direction, and reinforces whatever character a place
already has — so its quarters get more coherent over time and its culture reaches
further for exactly the reason yours does (`04`).

**It has no rubber band.** It does not build faster when it is losing. If you
out-build it you stay ahead, and staying ahead is meant to be the reward rather
than something the game keeps taking back.

Measured over a run from the seeded test town: the rival went from 1663 to 2476
cells of ground while the player went 4822 → 5203. Both grow; the player stays
ahead by building faster. Stop building and that reverses, which is the whole
point of putting it in.

Two honest caveats. The rival still only *adds buildings* — it cannot take a
building off you, so pressure is currently territorial only, and military
pressure remains unbuilt. And the rates (build interval, food per household)
were tuned against this container's ~3 ticks/sec, which is an artefact of
software rendering rather than a real frame budget; they will need re-tuning on
hardware with a GPU.

---

## Part 4 — The innovation core

"Settlers + SimCity + light combat" is a genre, not an idea. Here are the pillars
that would make this a specific game. A and B are the strong ones.

### Pillar A — The city as a readable body (no-numbers UI)

**A hard constraint: the interface shows almost no numbers.** Every system's state
is expressed spatially, visually, or posturally.

- Economy → flow thickness on connections
- Building health → the building's posture and activity
- Population mood → crowd density, where people gather, what they're doing
- Territory → border contours
- Military → warband banners and bearing

You diagnose your city **by looking at it**. **The map is the dashboard.**

This is a radical constraint and it's the most direct possible expression of the
Part 2 thesis. It also forces the game to be beautiful, because beauty and
readability become the same engineering problem.

**Held as an experiment, not a commitment.** Build the visual-only version first
and find out empirically where it breaks. Expected pressure points: warband
engagement odds, and the two pressure fields at a contested border. If numbers
have to be admitted, admit them *there* and nowhere else, and treat each one as a
design failure to be re-attacked later rather than a normal UI element.

### Pillar B — Evolution, not accretion

You place every building; the town ages, densifies, decays, renews and infills
around your work without ever overriding it. (Axis 1, Option D.)

The payoff is that **the town becomes a visible record of your judgement** —
flourishing where you sited well, rotting where you didn't — so Pillar A gets its
most important feedback channel for free. Combined, the town's silhouette is
simultaneously the art, the feedback, and the score.

### Pillar C — Continuous world, player-owned beats

Real-time with pause; seasons as cycle and flavour, never as a gate. Events arrive
as interruptions and the player chooses when to stop the world. (Axis 6.)

### Pillar D — Dual pressure: you can win land by being good at living

**Promoted to the lead pillar.** Borders are contested by military pressure *and*
cultural pressure, which behave nothing alike. Military takes; culture keeps. The
result is that **playing the city-building game well is itself the territorial
game** — a prosperous, beautiful, well-sited town pushes its borders outward on
its own, and a grim garrison town loses ground to a nicer neighbour even in
peacetime.

This is the answer to the oldest problem in city-sims-with-combat: the two halves
stop competing for attention because they are the same activity. Full treatment in
`01-territory-and-pressure.md`.

### Pillar E — The city remembers

Depth through **history** rather than through systems. Buildings age, get patched,
get replaced. Districts acquire character from what happened to them — a quarter
that survived a siege becomes the veterans' district, with its own flavour and its
own named people. Over a long game the city accumulates **story instead of stats**.

This is the strongest answer to "more developed than Polytopia." Polytopia is thin
because it's *disposable* — a 30-turn game leaves nothing behind. Depth-via-history
adds no maintenance burden, no arithmetic, and no UI, but makes a long game
accumulate meaning. It's development in exactly the dimension Polytopia lacks,
without any of the complexity you're allergic to.

### Pillar F — Speculative dial: the town has its own plans

Citizens occasionally build things you didn't ask for when conditions are right.
You're a founder and steward, not a god. Interesting, risky, probably a **dial** to
tune rather than a pillar to commit to — full autonomy would undercut authorship.

---

## Part 5 — Open tensions, honestly

1. **"No numbers" vs. combat and contested borders.** Warband engagements and
   two overlapping pressure fields both want a legible comparison. Deliberately
   left open to prototype (Pillar A).
2. ~~Emergent growth vs. the pleasure of arranging.~~ **Resolved:** authorship
   wins, evolution elaborates. The successor risk is the inverse — *does evolution
   ever feel like the town disobeying you?* The "never override the plan" rule
   exists to prevent this, and it needs testing with a real player, not reasoning.
3. **Small population vs. ambition.** Hundreds of citizens keeps it a toy and keeps
   agent simulation cheap, but caps the "watch a metropolis rise" fantasy. Probably
   correct to accept, but it is a real trade.
4. **Self-throttling production removes ratio math — does it remove too much
   challenge?** If nothing can ever be *wrong*, is the economy still a game? The
   answer is probably that the challenge relocates to *placement* and *timing*
   rather than *proportion* — but that needs to be verified, not assumed.
5. **Real-time idle risk.** No jams, no ratios, no turn beats. If the border
   doesn't supply enough continuous motion, the mid-game could go slack. First
   thing to measure in a playable build.
6. **Does densification fight the toy scale?** Pillar B's densification pushes
   towards bigger, denser settlements while the "little toy city" fantasy wants
   small. Densification may need a low ceiling — cottage → townhouse → terrace and
   stop, never tower blocks.

---

## Part 6 — What the game is, in one paragraph

> You found a settlement and you place every building in it yourself — the sawmill
> by the treeline, the smelter by the ore, each cottage where you want it. Then
> time gets to work on your composition: buildings weather and patch, well-sited
> ones grow into townhouses, badly-sited ones sag into slums, and alleys and yards
> fill in between the things you drew. Goods visibly walk from building to
> building, but nothing ever jams and there is no ratio to compute, so you read
> your town by looking at it rather than at a panel — and a mature town is a
> visible record of how well you judged it. Your borders are a living contour, and
> they are pushed by two different things: towers, which seize ground fast and
> lose it fast, and the sheer quality of your town, which converts ground slowly
> and holds it long after the soldiers leave. So a nice place quietly grows and a
> grim one quietly shrinks, and the way to defend a frontier is to make the
> frontier somewhere people want to live. War is a few named warbands tethered to
> how far your economy actually reaches; take a town and you inherit it working
> and sullen, and winning it over is a city-building problem, not a military one.
> Years pass and the place accumulates a history — aged buildings, named citizens,
> districts that remember what happened to them.
