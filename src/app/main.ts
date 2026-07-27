import { Application } from 'pixi.js';
import {
  COHERENCE_THRESHOLD,
  World,
  WORLD_SIZE,
  buildingType,
  placeableTypes,
  type BuildingFamily,
  type RoadClass,
  type Vec2,
} from '../sim';
import { Camera } from '../render/camera';
import { CHARACTER_COLOURS, CHARACTER_LABELS } from '../render/palette';
import { WorldView } from '../render/worldView';
import type { ViewMode } from '../render/projection';
import { seedTestTown } from './testTown';

const SIM_TICK_MS = 100;

/**
 * How near a road a building has to be before it snaps to its frontage, and how
 * far back from the kerb it then sits (design/05 §7). Placing near a road is a
 * deliberate act, so the alignment is exact; placing away from one is not.
 */
const FRONTAGE_SNAP = 26;
const SETBACK = 1.6;
const FAMILY_ORDER: BuildingFamily[] = ['economic', 'civic', 'residential'];
const FAMILY_LABELS: Record<BuildingFamily, string> = {
  economic: 'Economic',
  civic: 'Civic',
  residential: 'Residential',
};

async function main(): Promise<void> {
  const app = new Application();
  await app.init({
    background: '#14181d',
    resizeTo: window,
    antialias: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  document.body.appendChild(app.canvas);

  const world = new World(20260727);
  const camera = new Camera(app.screen.width, app.screen.height);
  const view = new WorldView(world, camera, 'iso');
  app.stage.addChild(view.root);

  // Open on the ground the test town occupies, close enough to read a street.
  const startX = WORLD_SIZE / 2 + 60;
  const startY = WORLD_SIZE / 2 + 60;
  camera.centreOnWorld(
    startX,
    startY,
    world.terrain.heightAt(startX, startY),
    view.currentProjection,
  );
  camera.zoom = 2.4;

  let selectedType: string | null = null;
  let paving = false;
  let roadClass: RoadClass | null = null;
  let roadPoints: Vec2[] = [];
  let paused = false;
  let cursor: { x: number; y: number } | null = null;

  /**
   * Where a building would actually go, given the road it is being placed
   * against. This is the intentional half of the fabric: near a road you are
   * building a frontage, not dropping a box in a field.
   */
  function resolvePlacement(
    typeId: string,
    at: Vec2,
  ): { pos: Vec2; rotation: number } {
    const hit = world.roadNear(at, FRONTAGE_SNAP);
    if (!hit) return { pos: at, rotation: 0 };

    const type = buildingType(typeId);
    // Which side of the road the cursor is on decides which side we build.
    const nx = -Math.sin(hit.angle);
    const ny = Math.cos(hit.angle);
    const side = Math.sign((at.x - hit.point.x) * nx + (at.y - hit.point.y) * ny) || 1;
    const out = hit.halfWidth + SETBACK + type.depth / 2;

    return {
      pos: { x: hit.point.x + nx * side * out, y: hit.point.y + ny * side * out },
      rotation: hit.angle,
    };
  }

  // ---- Palette -----------------------------------------------------------
  const paletteHost = document.getElementById('palette-items')!;
  const itemButtons = new Map<string, HTMLButtonElement>();

  for (const family of FAMILY_ORDER) {
    const types = placeableTypes().filter((t) => t.family === family);
    if (types.length === 0) continue;

    const heading = document.createElement('div');
    heading.className = 'family';
    heading.textContent = FAMILY_LABELS[family];
    paletteHost.appendChild(heading);

    for (const type of types) {
      const btn = document.createElement('button');
      btn.className = 'item';
      btn.setAttribute('aria-pressed', 'false');

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      const strongest = [...type.emissions].sort((a, b) => b.strength - a.strength)[0];
      swatch.style.background = strongest
        ? `#${CHARACTER_COLOURS[strongest.character].toString(16).padStart(6, '0')}`
        : '#9c8f7d';

      const label = document.createElement('span');
      label.textContent = type.name;

      btn.append(swatch, label);
      btn.addEventListener('click', () => selectType(type.id));
      paletteHost.appendChild(btn);
      itemButtons.set(type.id, btn);
    }
  }

  function selectType(id: string | null): void {
    if (id) {
      setRoadClass(null);
      paving = false;
      btnPave?.setAttribute('aria-pressed', 'false');
    }
    selectedType = selectedType === id ? null : id;
    for (const [typeId, btn] of itemButtons) {
      btn.setAttribute('aria-pressed', String(typeId === selectedType));
    }
    if (!selectedType) view.setGhost(null, null, false);
  }

  // ---- Controls ----------------------------------------------------------
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  const btnIso = el<HTMLButtonElement>('view-iso');
  const btnPlan = el<HTMLButtonElement>('view-plan');
  const btnOverlay = el<HTMLButtonElement>('toggle-overlay');
  const btnStreets = el<HTMLButtonElement>('toggle-streets');
  const btnPause = el<HTMLButtonElement>('toggle-pause');

  function setView(mode: ViewMode): void {
    view.setViewMode(mode);
    btnIso.setAttribute('aria-pressed', String(mode === 'iso'));
    btnPlan.setAttribute('aria-pressed', String(mode === 'plan'));
  }

  function setOverlay(on: boolean): void {
    view.showOverlay = on;
    view.markOverlayDirty();
    btnOverlay.setAttribute('aria-pressed', String(on));
  }

  function setPaused(on: boolean): void {
    paused = on;
    btnPause.setAttribute('aria-pressed', String(on));
    btnPause.textContent = on ? 'Resume' : 'Pause';
  }

  btnIso.addEventListener('click', () => setView('iso'));
  btnPlan.addEventListener('click', () => setView('plan'));
  function setStreets(on: boolean): void {
    view.showStreets = on;
    btnStreets.setAttribute('aria-pressed', String(on));
  }

  const btnFlow = el<HTMLButtonElement>('toggle-flow');
  btnFlow.addEventListener('click', () => {
    world.useFlow = !world.useFlow;
    world.invalidateField();
    btnFlow.setAttribute('aria-pressed', String(world.useFlow));
  });

  const btnPave = el<HTMLButtonElement>('tool-pave');
  btnPave.setAttribute('aria-pressed', 'false');
  btnPave.addEventListener('click', () => setPaving(!paving));

  const roadButtons: Record<RoadClass, HTMLButtonElement> = {
    lane: el<HTMLButtonElement>('road-lane'),
    street: el<HTMLButtonElement>('road-street'),
    high: el<HTMLButtonElement>('road-high'),
  };

  function setPaving(on: boolean): void {
    paving = on;
    btnPave.setAttribute('aria-pressed', String(on));
    view.clearGhost();
    if (on) {
      roadClass = null;
      roadPoints = [];
      for (const btn of Object.values(roadButtons)) btn.setAttribute('aria-pressed', 'false');
      selectType(null);
    }
  }

  function setRoadClass(cls: RoadClass | null): void {
    roadClass = cls;
    roadPoints = [];
    view.clearGhost();
    if (cls) setPaving(false);
    for (const [k, btn] of Object.entries(roadButtons)) {
      btn.setAttribute('aria-pressed', String(k === cls));
    }
    if (cls) selectType(null);
  }

  for (const [cls, btn] of Object.entries(roadButtons)) {
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () =>
      setRoadClass(roadClass === cls ? null : (cls as RoadClass)),
    );
  }

  function finishRoad(): void {
    if (roadClass && roadPoints.length >= 2) {
      world.addRoad(roadPoints, roadClass);
      world.rebuildFabric();
      view.markBuildingsDirty();
    }
    roadPoints = [];
    view.clearGhost();
  }

  btnOverlay.addEventListener('click', () => setOverlay(!view.showOverlay));
  btnStreets.addEventListener('click', () => setStreets(!view.showStreets));
  btnPause.addEventListener('click', () => setPaused(!paused));

  el('seed-town').addEventListener('click', () => {
    seedTestTown(world);
    world.rebuildFabric();
    view.markBuildingsDirty();
  });

  el('clear-town').addEventListener('click', () => {
    for (const b of [...world.buildings]) world.remove(b.id);
    view.markBuildingsDirty();
  });

  // ---- Input -------------------------------------------------------------
  const canvas = app.canvas;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  let panning = false;
  let lastPan = { x: 0, y: 0 };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      // Right-click finishes a road rather than panning, when one is in progress.
      if (roadClass && roadPoints.length > 0) {
        finishRoad();
        return;
      }
    }

    if (e.button === 2 || e.button === 1) {
      panning = true;
      lastPan = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0) return;
    const w = camera.screenToWorld(e.offsetX, e.offsetY, view.currentProjection);

    if (paving) {
      if (world.paveNearestPath(w)) {
        world.rebuildFabric();
        view.markBuildingsDirty();
      }
      return;
    }

    if (roadClass) {
      roadPoints.push(w);
      return;
    }

    if (e.shiftKey) {
      const hit = world.buildingAt(w.x, w.y);
      if (hit && world.remove(hit.id)) view.markBuildingsDirty();
      return;
    }

    if (!selectedType) return;
    const resolved = resolvePlacement(selectedType, w);
    if (world.place(selectedType, resolved.pos, resolved.rotation).ok) {
      view.markBuildingsDirty();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (panning) {
      camera.panByScreen(e.clientX - lastPan.x, e.clientY - lastPan.y);
      lastPan = { x: e.clientX, y: e.clientY };
      return;
    }
    cursor = { x: e.offsetX, y: e.offsetY };
  });

  const endPan = (e: PointerEvent) => {
    if (!panning) return;
    panning = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);
  canvas.addEventListener('pointerleave', () => {
    cursor = null;
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      camera.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (paving) setPaving(false);
      else if (roadClass) setRoadClass(null);
      else selectType(null);
    } else if (e.key === 'Enter') finishRoad();
    else if (e.key === 'c' || e.key === 'C') setOverlay(!view.showOverlay);
    else if (e.key === 's' || e.key === 'S') setStreets(!view.showStreets);
    else if (e.key === 'v' || e.key === 'V') setView(view.viewMode === 'iso' ? 'plan' : 'iso');
    else if (e.code === 'Space') {
      e.preventDefault();
      setPaused(!paused);
    }
  });

  window.addEventListener('resize', () => camera.resize(app.screen.width, app.screen.height));

  // ---- Readout -----------------------------------------------------------
  const rDominant = el('r-dominant');
  const rCoherence = el('r-coherence');
  const rBuilding = el('r-building');
  const rCount = el('r-count');
  const rStreets = el('r-streets');
  const rPeople = el('r-people');
  const rTown = el('r-town');
  const rStreet = el('r-street');
  el('r-townname').textContent = world.name;
  let townEvery = 0;
  const rTicks = el('r-ticks');

  function updateReadout(): void {
    rCount.textContent = String(world.buildings.length);
    rStreets.textContent = `${world.roads.length} / ${world.fabric.paths.length}`;
    rPeople.textContent = String(world.crowd.people.length);

    // Scanning every cell is too slow for every frame, and it barely changes.
    if (townEvery++ % 45 === 0) {
      const stats = world.field.townCoherence();
      rTown.textContent = stats.cells
        ? `${Math.round(stats.mean * 100)}% over ${stats.cells}`
        : '—';
    }
    rTicks.textContent = String(world.ticks);

    if (!cursor) {
      rDominant.textContent = '—';
      rCoherence.textContent = '—';
      rBuilding.textContent = '—';
      return;
    }

    const w = camera.screenToWorld(cursor.x, cursor.y, view.currentProjection);
    const reading = world.field.read(w.x, w.y);

    if (reading.dominant) {
      rDominant.textContent = CHARACTER_LABELS[reading.dominant];
      rDominant.style.color = `#${CHARACTER_COLOURS[reading.dominant]
        .toString(16)
        .padStart(6, '0')}`;
      const pct = Math.round(reading.coherence * 100);
      rCoherence.textContent =
        `${pct}%` + (reading.coherence >= COHERENCE_THRESHOLD ? '' : ' (muddled)');
    } else {
      rDominant.textContent = 'Open country';
      rDominant.style.color = '';
      rCoherence.textContent = '—';
    }

    const road = world.roadNear(w, 14);
    rStreet.textContent = road?.road.name ?? '—';

    const hit = world.buildingAt(w.x, w.y);
    rBuilding.textContent = hit ? buildingType(hit.typeId).name : '—';
  }

  // ---- Loop --------------------------------------------------------------
  let sinceTick = 0;

  app.ticker.add((ticker) => {
    if (!paused) {
      sinceTick += ticker.deltaMS;
      while (sinceTick >= SIM_TICK_MS) {
        const before = world.buildings.map((b) => b.typeId).join();
        world.tick();
        if (world.buildings.map((b) => b.typeId).join() !== before) {
          view.markBuildingsDirty();
        }
        sinceTick -= SIM_TICK_MS;
      }
    }

    if (cursor && paving) {
      const w = camera.screenToWorld(cursor.x, cursor.y, view.currentProjection);
      view.clearGhost();
      const found = world.pathNear(w, 22);
      view.setPaveHighlight(found ? found.path : null);
    } else if (cursor && roadClass) {
      const w = camera.screenToWorld(cursor.x, cursor.y, view.currentProjection);
      view.clearGhost();
      view.setRoadPreview(roadPoints.length ? [...roadPoints, w] : null, roadClass);
    } else if (cursor && selectedType) {
      const w = camera.screenToWorld(cursor.x, cursor.y, view.currentProjection);
      const resolved = resolvePlacement(selectedType, w);
      view.setGhost(
        selectedType,
        resolved.pos,
        world.canPlace(selectedType, resolved.pos).ok,
        resolved.rotation,
      );
    }

    const dt = ticker.deltaMS / 1000;
    if (!paused) world.updatePeople(dt);

    view.render(paused ? 0 : dt);
    updateReadout();
  });
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:20px;color:#f88">${String(err)}</pre>`;
});
