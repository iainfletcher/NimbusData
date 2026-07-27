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
give a rambling settlement. But it makes an open question sharp: **should buildings
settle onto frontages over time?** A small nudge toward the nearest street, applied
as part of evolution, would let a loosely placed cluster tidy itself into a street
over a few years. It's very much in the spirit of "you author it, it evolves" —
but it edges against the rule in `00` that evolution must never override the plan.
A few metres of settling is probably elaboration; anything more is relocation.

Not decided. It's the most interesting open question the prototype has produced.

## 7. Risks

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
