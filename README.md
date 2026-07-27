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

Milestones 0–3, 5 and 6 are done, and 4 is largely done (`design/06` §4):

- Terrain generation with a river, and placement rules that respect water and slope
- The character field: emission, diffusion, dominant and coherence
- Both projections — isometric world view and top-down plan — at matching scale
- Housing evolving into the house that belongs where it stands
- Player-drawn roads as the armature, and worn desire paths in the gaps
- Buildings snapping to a road frontage, or facing a worn path more loosely
- Per-character materials and roof forms — brick and slate, render and tile,
  limestone and lead, with spires and chimneys for landmarks
- Windows, doors, chimneys, dormers, overhanging eaves, exposed timber framing
  and per-building weathering
- Generated detail: woodland, hedged and walled plots, vegetable rows, working
  yards, churchyards, orchards and greens — none of it placed by the player
- Place, remove, pan, zoom, pause, and overlays for character and streets

- Ambient people walking the network, depth-sorted against buildings

**Not yet built:** paving a worn path into a road; market stalls, strip fields
and animals; anything beyond the medieval era.

Press **Seed test town**, then **Character** to see the field and **Plan** to read
the street layout.
