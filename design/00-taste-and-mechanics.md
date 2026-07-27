# Design Exploration 01 — Taste Profile & Mechanic Space

Status: thinking document. Nothing here is committed to. The goal is to find where
the ideal sits by laying out each axis honestly and picking a favourite.

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
| C. **Split vocabulary** | Author the skeleton, watch the flesh | Less control over final look |

**Recommendation: C.** You place the things with *intent* — production, civic,
infrastructure, military. Housing, shops, and small streets **grow themselves**
around them.

The mechanism: **homes follow jobs.** Place a sawmill at the treeline and a hamlet
accretes around it. Place a smelter across the valley and a second cluster forms.
You never paint a zone; you place a reason for people to be somewhere, and they
come.

This is worth dwelling on because it does two jobs at once. It's the SimCity
surprise engine, *and* it makes the settlement's shape a readout of your economic
decisions. **Looking at the town tells you what your economy is.** A lopsided town
means a lopsided economy. That's diagnosis-by-eyeball, which is Part 2's thesis
made concrete.

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
| C. **Pressure field + few named warbands** | Spatial *and* decisive | Novel, needs tuning |

**Recommendation: C.**

**Territory as a pressure field.** Territory is continuous, not tile-claimed. Every
military building projects pressure outward, decaying with distance. **The border
sits where opposing pressures balance.** Build forward and the contour bulges.
Lose a tower and it recedes. You expand by *building*, exactly like Settlers, but
the border is a smooth living contour rather than a stack of claimed hexes — a map
that visibly breathes.

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

Polytopia's punch is turn-based. Settlers/SimCity/Theme Park's charm is real-time
watching. These seem opposed. They aren't necessarily.

**Recommendation to consider seriously: seasonal cadence.**

Real-time within a season — the economy runs, carriers walk, the town grows, you
watch and tweak. Then a **season boundary**: a decision beat where you commit build
orders, declare war, set policy, respond to events.

This gets you:
- Real-time's living, watchable economy.
- Turn-based's punchy, considered decisions.
- Natural pacing and a "one more season" hook.
- A clean place to hang events, migrations, and the town's story.

The alternative — pure real-time with generous pause — is safer and more
conventional. Seasonal is the more interesting bet.

### Axis 7 — Where does pressure come from?

A toy city with no pressure is a screensaver. But pressure must not come from
punishing arithmetic, or we're back to the thing you dislike.

**Recommendation: pressure arrives from outside and from time — never from your own
bookkeeping.** Winters. Rival expansion. Migration waves. Demands from a distant
crown. Fire, flood, a bad harvest.

You are never punished for miscalculating a ratio. You are pressured by events you
must *adapt* to. Adaptation is interesting; arithmetic is a chore.

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
readability become the same engineering problem. It will fight combat resolution
and economy tuning — that tension is real and is the main thing to pressure-test.

### Pillar B — Growth as accretion

No zoning, no manual housing. The town's shape emerges around what you place. The
settlement is a **portrait of your decisions**. Combined with Pillar A, the town's
silhouette is simultaneously the art, the feedback, and the score.

### Pillar C — Seasonal cadence

Watch in real time, decide in beats. (Axis 6.)

### Pillar D — Territory as pressure, war as supply

Combat that operates on the same objects as peace, and is paced by the same
economy. (Axis 4.)

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

1. **"No numbers" vs. combat.** Warband engagements need *some* legible strength
   comparison. How far does the constraint bend? (Posture, banner size, and visible
   veterancy might carry it — worth prototyping before deciding.)
2. **Emergent growth vs. the pleasure of arranging.** Pillar B removes the ability
   to lovingly place a house. If "building little toy cities" means the pleasure of
   *arranging*, Pillar B is fighting the core fantasy rather than serving it. **This
   is the biggest unresolved question in the document.**
3. **Small population vs. ambition.** Hundreds of citizens keeps it a toy and keeps
   agent simulation cheap, but caps the "watch a metropolis rise" fantasy. Probably
   correct to accept, but it is a real trade.
4. **Self-throttling production removes ratio math — does it remove too much
   challenge?** If nothing can ever be *wrong*, is the economy still a game? The
   answer is probably that the challenge relocates to *placement* and *timing*
   rather than *proportion* — but that needs to be verified, not assumed.

---

## Part 6 — What the game is, in one paragraph

> You found a settlement. You place the reasons for people to be somewhere — a
> sawmill by the treeline, a smelter by the ore — and homes, shops and streets
> accrete around them, so the shape of your town is a portrait of your economy.
> Goods visibly walk between buildings, but nothing ever jams and there is no ratio
> to compute; you make placement decisions, and you read the results by looking at
> the town rather than at a panel. Seasons pass in real time and turn on a decision
> beat. Your borders are a living contour pushed outward by what you build, and war
> is a few named warbands tethered to how far your economy can actually reach —
> when you take a town, you inherit it working and sullen rather than razed. Over
> many seasons the place accumulates a history: aged buildings, named citizens,
> districts that remember what happened to them.
