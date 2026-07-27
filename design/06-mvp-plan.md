# Design Exploration 07 — What Needs Deciding, and the MVP

Organised around the actual question: **what blocks writing code?**

## Decisions taken

| | Decision | Consequence |
|---|---|---|
| **D1** | **Game B — the city builder** | `02`'s recommendation is set aside deliberately. Game A is shelved, not cancelled |
| **D2** | **TypeScript + PixiJS**, sim core engine-agnostic | Fast iteration; Godot migration stays a rendering rewrite, not a rewrite |
| **D3** | **Both views** — isometric world, top-down plan | Tests aesthetic and fabric legibility from day one |
| **D4** | **A foundation to keep building on** | Architecture discipline from the first commit; the layer boundary is enforced, not merely intended |

D4 raises the bar on D2. Since this code survives, the boundary between simulation
and rendering is enforced by a check in CI rather than by good intentions — see
`ARCHITECTURE.md`.

---

## 1. Decisions that genuinely block

Four. Everything else can be decided later or discovered by building.

### D1 — Which game?

`02` argued Game A (the holiday camp) should be built first: bounded scope, it
de-risks the shared systems cheaply, a far more distinctive aesthetic, and a
natural ending. That recommendation was never actually answered — the conversation
moved to Game B and stayed there through four documents.

Both are viable. Game B now has considerably more design behind it, which is itself
an argument for building it. But it's also much larger, and the argument in `02`
hasn't been refuted, only overtaken.

**This is the only decision that changes everything downstream.**

### D2 — Tech stack

**Recommendation: TypeScript + PixiJS (WebGL 2D).**

The reasoning is specific to how this project is going, rather than generic:

- **Instant iteration and instant sharing.** A prototype is a link you open. Given
  a design process built on looking at a thing and reacting to it, that loop being
  seconds rather than minutes matters more than raw performance.
- **The MVP is small.** A single town with a few hundred sprites and a coarse field
  grid is trivially within budget for WebGL.
- **The risk of wasted work is low** if the architecture below is respected.

The main alternative is **Godot 4** — better long-term for a shipped desktop game,
better tooling, better performance ceiling, but a slower loop and nothing to click
on without a build.

**Architectural rule that makes this decision cheap to reverse:**

> **The simulation core is engine-agnostic. Rendering is a thin layer over it.**

Character fields, coherence, evolution rules, fabric generation and pressure fields
are all plain logic over plain data. None of it should import a rendering library.
If the core is clean, moving to Godot later is a rendering rewrite, not a rewrite.

### D3 — Perspective

Genuinely consequential and not obvious:

- **Isometric** matches the stated aesthetic — CD32, Bullfrog, Settlers, Theme
  Park. It's the look you're after.
- **Top-down** reads *street plans* far better, which matters because fabric
  (`05`) is one of the two riskiest things to prove, and it's much faster to build.

They aren't exclusive — a plan/map view is likely needed regardless. But the
prototype has to start as one of them.

### D4 — What is the MVP *for*?

Changes the scope advice materially:

- **Proving the feel to yourself** → smallest possible, ugly placeholders, no
  polish, throw it away after.
- **Something to show people** → needs enough art and framing to read as a game.
- **A foundation to keep building on** → architecture and scope discipline matter
  much more from day one.

---

## 2. Decisions I'd just make (flagging, not asking)

These need answers but don't need *your* answer — sensible defaults exist and
they're cheap to change:

| Decision | Call | Why |
|---|---|---|
| **Map representation** | Coarse **field grid** (~4m cells) for character/pressure/utilities, **continuous positions** for buildings and roads | Fields want a grid; organic fabric and rail curves want continuity. Chunky tiles are ruled out — they'd make organic fabric impossible |
| **Scale** | Buildings 8–15m, town 1–2km across, hundreds of citizens | `00` decided toy scale over metropolis |
| **Field update** | Diffusion pass on the coarse grid, a few times a second, not per-frame | Character spreads slowly; no need for real-time precision |
| **Time** | ~1 real minute ≈ 1 in-game year in the medieval era, slowing as eras progress | Placeholder; will need tuning against how long a building takes to evolve |
| **Save format** | JSON, versioned, unoptimised | Premature optimisation is the enemy at this stage |

---

## 3. Proposed MVP (Game B)

**The principle: build the smallest thing that tests the two riskiest assumptions.**

Ranked by risk, the things most likely to sink this design are:

1. **Does organic fabric generation actually look good?** (`05` §6.2 — the largest
   engineering risk in the design.) If procedural streets look like noise, a
   central pillar is gone.
2. **Do character and coherence produce visibly distinct, readable districts?**
   (`04`.) If districts don't read at a glance, the no-numbers pillar collapses and
   the vibe → evolution → culture chain has no foundation.

Everything else — territory, combat, eras, economy — sits *on top* of those two. So
neither belongs in the MVP.

### In scope

- **One map**, fixed handcrafted terrain, **medieval era only**.
- **~15–20 building types** across the four families, enough to express **5–6
  characters** (suggest: Industrious, Mercantile, Devout, Rustic, Raucous, Verdant).
- **Placement**: put buildings down, including housing.
- **Character field**: emission, diffusion, terrain/wind flow, dominant + coherence.
- **Organic fabric generation**: streets, lanes, yards and infill emerging between
  placed buildings.
- **Building evolution**: two or three steps, driven by dominant character, so a
  cottage becomes the house that belongs there.
- **Decorative agents**: ambient people for life. No needs, no pathfinding
  intelligence, no simulation — pure feedback, per the decorative-logistics rule.
- **Visual character identity**: enough palette and idiom differentiation to tell
  quarters apart.

### Explicitly out

Territory and pressure fields · combat and warbands · eras beyond medieval ·
production chains and economy (buildings just exist) · utilities · transport
engineering · planned fabric · citizen needs and named citizens · sound ·
save/load · any UI beyond place-and-inspect.

Planned fabric is deliberately cut despite being interesting — organic is the risky
one, and it's the one that has to work first.

### Success criteria

Concrete, and answerable by looking:

1. Place forty buildings in three loose clusters and the resulting town has **three
   visibly different quarters** you can identify **with the labels off**.
2. The street layout looks like **a place**, not like noise or like a grid.
3. Watching a cottage become a workers' terrace because you put a foundry nearby is
   **satisfying and comprehensible** without a single number.

If all three land, the design is real and the rest is construction. If (1) or (3)
fails, `04` needs rework. If (2) fails, `05` needs a fundamental rethink — possibly
authored street templates rather than procedural generation.

---

## 4. Rough milestones

| # | Milestone | Proves |
|---|---|---|
| **0** | ✅ Repo, build, empty map renders, camera pans and zooms | Stack works |
| **1** | ✅ Place a building. It appears. Terrain blocks placement | Core interaction |
| **2** | ✅ Character field: emit, diffuse, and **debug-visualise it** | The field maths |
| **3** | ✅ Dominant + coherence computed and visualised per cell | `04`'s core |
| **4** | ◐ Organic fabric: streets generate between buildings | **The big risk** — see `05` §6 |
| **5** | ✅ Buildings evolve by dominant character, 2–3 steps | The chain's payoff |
| **6** | ⬜ Visual character identity — palettes and idioms per character | Legibility |
| **7** | ⬜ Ambient agents | Aliveness |

Both projections were built up front rather than at milestone 6, since D3 chose
both views and the plan view turned out to be essential for judging fabric.

Milestone 4 is **partly** done: streets generate as desire lines and work well
between places, but within a cluster the fabric is only as linear as the player's
placement. Findings and the open question in `05` §6. Infill (yards, walls, back
lanes) is not started.

### What the first build shows

Seeding the test town and turning on the character overlay produces three
readable quarters, and two things worth noting happened without being designed for:

- **The tavern's Raucous bleeds into the market's Mercantile**, showing as a rose
  smudge on one edge of the trading quarter. Exactly the discord `04` predicts,
  visible without a number.
- **The church quarter is visibly less coherent than the other two**, because
  Devout and Verdant are competing there. That's the coherence mechanic doing its
  job as a diagnostic, and it suggests the green and the orchard want to be
  further from the church than the test town puts them.

Housing evolution reads well: merchant houses appear around the market, workers'
terraces around the foundry, close cottages and garden cottages by the church.

**Caveat on success criterion 1.** Quarters currently read as different because
each character has a placeholder *colour*. That's a weak proxy — the real test is
whether they read from architecture, materials and street furniture (`04` §5),
which is milestone 6. Colour passing is necessary but nowhere near sufficient.

Milestone 4 is where this either works or doesn't, so it's worth reaching fast —
possibly even reordering it earlier with a hardcoded character field, to fail cheap
if it's going to fail.

---

## 5. If Game A is chosen instead

The MVP is different and considerably smaller, and it's already specified in `02`
§11:

> One camp, one week, rain on Wednesday.

Can you watch a family arrive, split up, do things, argue, reconvene and go home
happy or not — and can you tell *which* and *why* without opening a panel? Riskiest
assumptions there are **family-as-unit legibility** and **whether a rained-off week
is fun to rescue**. No fabric generation, no character fields, no territory.

Notably it shares the tech stack decision, the architectural rule, and the agent
work — but almost none of the systems.
