# Architecture

## The one rule

> **`src/sim` is engine-agnostic. It must never import a rendering library, a DOM
> API, or anything from `src/render` or `src/app`.**

Character fields, coherence, evolution, fabric generation and (later) pressure
fields are plain logic over plain data. Keeping them clean means a future move to
Godot or a native engine is a *rendering* rewrite, not a rewrite.

This is enforced, not merely intended: `npm run check:layers` fails the build if
anything under `src/sim` imports across the boundary.

### The payoff, which is bigger than portability

Because the core depends on nothing outside itself, **it runs in plain Node with
no browser, no canvas and no Pixi**. `npm run trial` compiles `src/sim` on its
own and exercises it headlessly, so a claim in a design document can be stated,
run and measured instead of eyeballed in a screenshot.

That turned out to be worth more than the engine portability the rule was written
for. The first run of the military trials failed six of eleven claims, and three
of those were the *design* being wrong rather than the code (`design/01` §10).
Compiling the layer in isolation is also the strictest possible check that the
boundary is intact: if the trial harness stops compiling, the rule has been
broken somewhere the import scanner missed.

## Layers

```
src/sim/      Simulation core. Pure TypeScript, no I/O, no rendering.
              Deterministic given a seed. The thing that survives.

src/render/   PixiJS. Reads sim state, draws it. Owns projections, camera,
              palettes. Never mutates sim state.

src/app/      Glue: bootstrap, input handling, the main loop, UI chrome.
              The only layer allowed to talk to both.
```

Dependency direction is strictly `app → render → sim`. Never upward.

## Coordinate systems

Three, kept deliberately distinct:

| Space | Units | Owned by |
|---|---|---|
| **World** | metres, continuous, `{x, y}` with terrain height sampled separately | `sim` |
| **Cell** | integer indices into the field/terrain grid, `CELL_SIZE` metres apart | `sim` |
| **Screen** | pixels, projection-dependent | `render` |

`sim` never knows about screen space. `render` converts world → screen via a
projection (isometric or plan), so adding a view is a projection, not a rewrite.

## Grid

One grid for terrain and the character field, at `CELL_SIZE = 4m`, covering a
`1024m × 1024m` world — 256 × 256 cells. Buildings sit at **continuous** world
positions, not on the grid, because organic fabric and rail curves need continuity
(see `design/03` §1 and `design/05`).

Field layers are `Float32Array` per character, indexed `y * width + x`.

## Simulation model

The field reaches a steady state each tick rather than integrating over time:

1. **Emit** — clear layers, then each building writes its character emissions with
   a radial falloff.
2. **Diffuse** — a few separable blur passes with decay, so character bleeds into
   neighbouring cells and terrain can later channel it.
3. **Read** — `dominant` (argmax over layers) and `coherence` (dominant's share of
   the total) are computed per cell on demand.

Coherence is the design's central quantity (`design/04`): high coherence means a
district knows what it is; low coherence is what produces squalor.

## Determinism

`sim` takes a seed and avoids `Math.random`. Same seed and same inputs must give
the same world — needed for reproducible bugs and, later, for saves.
