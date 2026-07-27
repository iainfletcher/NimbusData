# Design Exploration 06 — Fabric: Organic vs Planned (Game B)

Chaos versus planning. This is a real and valuable dimension, but it isn't a
character (`04`) and its cost shouldn't be admin. Both corrections make it better.

---

## 1. Two corrections to the framing

### It's not a character, it's a property of the fabric

Character is **what a district is**. Fabric is **how it's laid out**. They're
orthogonal, and keeping them separate multiplies variety without adding a
fourteenth character to the palette.

A Devout quarter can be **organic** — a medieval cathedral close, winding lanes,
buildings leaning into each other — or **planned** — a formal ecclesiastical
precinct around a laid-out square. Same character, completely different place.

Every character × both fabrics. That's a lot of towns from one extra system.

### The cost of planning is not admin

The instinct was "order for more admin." That would reintroduce exactly the disease
this design has been cutting, so it needs restating:

> **Effort that is expressive is not admin. Admin is effort with no expression.**

Filling in a bus timetable is admin. Laying out a Georgian crescent by hand is
**authorship** — it's the same category of effort as drawing a railway through a
ridge (`03` §4), and it's a pleasure, not a tax.

So the real axis is **emergence vs. authorship**, and both are first-class ways to
play. You pay for order with **money, time and commitment** — never with clicking.

---

## 2. The two fabrics

### Organic

- **How:** you place buildings loosely. Streets, lanes, yards and alleys infill
  between them, following desire lines and terrain.
- **Looks like:** winding, irregular, dense, surprising. An English market town.
- **Input:** low. The game surprises you.
- **Gives:** **vibrancy** — more life per square metre, chance encounters, bustle.
- **Costs:** networks are awkward to thread through it, it tips into incoherence
  more easily, and it handles motor traffic badly in the modern era.

### Planned

- **How:** you draw the layout *first* — grid, crescent, square, boulevard,
  terrace — and then build into it.
- **Looks like:** regular, legible, imposing. Bath, Edinburgh New Town.
- **Input:** high, but expressive. You get what you intended.
- **Gives:** **amplification** — see below.
- **Costs:** money and time, considerably more than letting it happen.

---

## 3. The trade: vibrancy vs. amplification

The temptation is to make planned = coherent, but coherence drives evolution and
culture (`04`), so that would make planning a strict upgrade. Instead:

> **Planned fabric amplifies whatever character it has.** Get it right and it's
> magnificent. Get it wrong and it's magnificently wrong — a sterile, handsome,
> empty quarter that nothing wants to be.
>
> **Organic fabric is forgiving and self-correcting**, but never reaches the same
> heights.

Risk and reward, not better and worse.

### What vibrancy actually does

It has to be a real reward, not a consolation prize. Vibrancy **generates life**:

- Migration — people want to be where things are happening.
- Events and incidents.
- **Named citizens** (`00`, Pillar E). Stories come out of crowded, irregular
  places, not out of boulevards.
- Boosts Mercantile and Raucous especially — markets need muddle.

Which produces the failure mode that makes this system worth having:

> **A perfectly planned city is handsome and dead.**

The best towns have both — a planned civic core with organic quarters around it,
which is exactly what real historic cities are. The design rewards the true answer
rather than an invented one.

---

## 4. The input dial — the accessibility win

The most valuable property here, and it's the part of your instinct that's most
worth keeping:

> **The player sets their own input level, moment to moment, and it isn't a
> difficulty setting.**

Feel like relaxing? Place buildings loosely and watch a town happen. Feel like
composing? Lay out a crescent and fill it deliberately. **Mix freely, switch
whenever, never locked in.** A player who plays almost entirely organic still has a
full game.

Very few builders let you choose how much effort to give them *today*. For a game
meant to be a toy sometimes and an obsession other times, that's a real feature.

---

## 5. The era arc

The axis has a historical shape built into it, which is a gift:

| Era | Fabric |
|---|---|
| **Medieval** | Organic by default, almost by necessity. Planning is rare and expensive — a planted town, a bastide. |
| **Early modern** | Planning arrives and becomes *fashionable*. The square, the crescent, the terrace. The great British planning era. |
| **Victorian** | Both at once — planned civic grandeur beside organic industrial sprawl. |
| **Modern** | Planning turns dominant and coercive. |

And it sharpens the endgame from `03` §6 considerably. Driving a motor road through
an organic medieval quarter destroys **two** things at once: its **fabric** (the
vibrancy that made it alive) and its **Antique** character (the cultural pressure
that made it strong). The modernisation dilemma gets teeth in both hands.

---

## 6. What the first implementation found

Milestone 4 is built (`src/sim/fabric.ts`). Streets are generated as **desire
lines**: every building routes to its nearest neighbours plus a spanning tree
across the whole town, each journey is A*'d over a terrain cost field, and ground
that carries more journeys is worn into a wider street. Hierarchy therefore falls
out rather than being authored — the lane that happens to be on everyone's way to
the market becomes the high street.

Three findings, in order of importance:

**1. It works at the between-places scale, immediately and well.** The road linking
the working quarter to the market curves round the contours and reads as a genuine
country road. This part needed no coaxing.

**2. It fails on randomly scattered buildings, and the failure is instructive.**
The first test town scattered buildings within a radius. The generator produced a
network that looped *around* each cluster like field boundaries, because a route
between two buildings on opposite sides of a scatter has no choice but to go round
the ones in between. **Scattered buildings give a street nothing to run along.**

**3. Laid out as rows along a spine — how anyone actually builds — it produces
readable streets with frontages.** Same algorithm, no tuning. The market quarter
now reads as a terrace.

One change was needed to get there: ground near a building frontage is **cheaper to
travel**, so routes gather into streets instead of striking out across open ground.
Without that, journeys took the cheapest line across a field and ignored the town.

### What this means for the pillar

Organic fabric survives, with an important refinement: **the two scales want
different treatment.**

- **Between places** — desire lines, working now.
- **Within a place** — the fabric can only be as linear as the placement is. The
  generator faithfully reflects what the player did, which is exactly what `05`
  asks of it, but it means a player who places loosely gets yards and blocks
  rather than streets.

That is arguably correct behaviour rather than a bug — loose placement *should*
give a rambling settlement. It raised the question of whether buildings ought to
**settle onto frontages over time**, nudged by evolution. That question is now
answered, and the answer is no. See §7.

## 7. Roads and paths — two kinds of route

The resolution, and it turned out to be the missing half of the whole system.

> **Roads are intentional. Paths are desire. They are different things, they look
> different, and they behave differently.**

**Roads** are drawn by the player. They are the armature: permanent, formal, a
made surface with a kerb. The town never draws one and never removes one.

**Paths** are worn by the town. Thin, wandering, informal, generated from journeys
exactly as before. They are what people tread into the gaps.

### How they interact

A road is a **cheap corridor** in the routing cost field. Once one exists,
journeys use it for the trunk of the trip, so the desire paths still needed are
**short spurs from a frontage to the nearest road** — plus the back lanes and
yards worn behind the frontages.

This makes the planned/organic dial **continuous and physical rather than a mode
switch**:

- Draw no roads → a rambling settlement threaded with tracks.
- Draw plenty → a formal town with lanes behind.
- Draw some → what a real British town actually is.

The dial from §4 is no longer a setting. It's a consequence of how much road you
chose to lay, and you can change your mind at any point.

### Frontage: how strictly a building lines up says what kind of place it is

- **Near a player-drawn road** — the frontage aligns *exactly*, at a consistent
  setback from the kerb. Placement snaps to it. This is what makes a terrace read
  as deliberate.
- **Near only a worn path** — the building faces it *loosely*, with a few degrees
  of deterministic wonk, so an unplanned lane doesn't look surveyed.
- **Near neither** — left as placed.

Most of the difference between a planned crescent and a rambling hamlet is this
one rule.

### Why this settles the authorship question

Buildings never need nudging, because **the player supplies the armature
deliberately**. Want a street? Lay a road and build along it — the snapping does
the rest, immediately and predictably. Want a hamlet? Don't, and let the paths
wander.

So evolution still never moves anything the player placed, and the rule in `00`
holds intact. Authorship is preserved *and* the organic fabric works, because the
intention arrives as a road rather than as a correction.

### Built and working

Implemented in `src/sim/roads.ts` and `src/sim/fabric.ts`. In plan view the two
kinds are immediately distinguishable: straight grey made roads carrying the
frontages, pale wandering tracks worn behind them into back lanes and yards.

### Paving a desire path — built

The game already knows where people actually walk, so the player can now **pave a
worn path into a road**: hover to highlight the track, click to make it permanent.
*The town shows you where it wants a road, and you decide whether to build it.*

The detail that makes it worth having: **a paved road keeps the path's exact
wander.** So the two origins stay visibly distinct — *roads you draw are straight
because you drew them; roads you pave bend because people did.* A mature town
ends up carrying its own history in the shape of its streets, which is Pillar E
arriving through the fabric system rather than through anything built for it.

Its class follows how well worn the track already was, so a heavily used route
paves as a street and a back way paves as a lane.

## 8. Built — planned fabric, and how thin it turned out to be

Crescent, square and grid are implemented (`plans.ts`), and the implementation is
about a hundred lines. That thinness is the finding:

> **A plan is nothing but a road generator.**

Frontage snapping already aligns buildings to whatever road they stand against,
so laying a curved road *is* laying out a crescent — the buildings that follow
sit on its arc at a consistent setback with no further machinery. The square is
four sides round an open middle; the grid is six straight lines. Nothing reserves
plots, nothing places buildings, nothing knows what a "crescent" is beyond its
geometry.

**And the cost asymmetry from §2 falls out for free.** These lay a great deal of
road, and road is paid for in stone by the metre, so planned fabric is expensive
exactly as the design wants without a special rule. A grid ran to 192 stone
against a crescent's 46.

What is *not* built is §3's amplification — planned fabric does not yet make its
character stronger or its failures worse. That remains the interesting half.

## 9. Risks

## 7. Risks

0. ~~Procedural organic fabric may not look convincing.~~ **Largely retired.**
   Desire-line routing over a terrain cost field, with roads as an armature,
   produces a network that reads as a place. The residual risk is aesthetic
   detail (infill, walls, yards), not the approach.
1. **Does planning become the min-maxer's obvious choice?** If so, the relaxed way
   to play becomes the losing way, which would be bad. Mitigation: planned fabric
   must cost real money and time, and vibrancy must be genuinely valuable. Needs
   watching closely.
2. **Procedurally generating good organic fabric is genuinely hard.** Street layouts
   that look like a real English market town — irregular but not random, dense but
   navigable — are easy to describe and hard to make look right. This is the biggest
   *engineering* risk in the design so far, and it should be prototyped early
   because a lot depends on it.
3. **Can players tell the two fabrics apart in their consequences?** Character is
   visible in the architecture; fabric is visible in the street plan, which is
   harder to read at ground level and may need the map view to communicate.
4. **Is mid-game conversion allowed?** Can you impose a plan on an existing organic
   quarter without demolishing it? Probably yes but expensively — that's the
   Victorian improvement scheme, and it's very characterful.
