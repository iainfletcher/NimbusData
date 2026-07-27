# Toy City

Prototype for a medieval-to-modern city builder. Small, legible, alive — the
player makes spatial decisions and never performs maintenance.

Design notes live in [`design/`](design/README.md); start with
[`design/README.md`](design/README.md). Code layering is described in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## Running it

```bash
npm install
npm run dev        # vite dev server
```

## Other commands

```bash
npm run check      # layer check + typecheck. Run before committing
npm run build      # single self-contained dist/index.html
npm run smoke      # loads the build in Chromium, screenshots to shots/
```

`npm run check:layers` enforces the rule from `ARCHITECTURE.md`: `src/sim` may not
import a rendering library, touch the DOM, or call `Math.random`.

## Current state

Milestones 0–3 and 5 of the MVP plan (`design/06` §4) are done:

- Terrain generation with a river, and placement rules that respect water and slope
- The character field: emission, diffusion, dominant and coherence
- Both projections — isometric world view and top-down plan — at matching scale
- Housing evolving into the house that belongs where it stands
- Place, remove, pan, zoom, pause, and a character overlay

**Not yet built:** organic fabric generation (milestone 4), which is the largest
open risk in the design. Everything currently visible is buildings on bare ground —
there are no streets.

Press **Seed test town** to lay down the arrangement the MVP is meant to be judged
against, then **Character** to see the field.
