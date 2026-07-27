import { Application } from 'pixi.js';
import {
  COHERENCE_THRESHOLD,
  World,
  WORLD_SIZE,
  buildingType,
  placeableTypes,
  type BuildingFamily,
} from '../sim';
import { Camera } from '../render/camera';
import { CHARACTER_COLOURS, CHARACTER_LABELS } from '../render/palette';
import { WorldView } from '../render/worldView';
import type { ViewMode } from '../render/projection';
import { seedTestTown } from './testTown';

const SIM_TICK_MS = 100;
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
  let paused = false;
  let cursor: { x: number; y: number } | null = null;

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
  btnOverlay.addEventListener('click', () => setOverlay(!view.showOverlay));
  btnPause.addEventListener('click', () => setPaused(!paused));

  el('seed-town').addEventListener('click', () => {
    seedTestTown(world);
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
    if (e.button === 2 || e.button === 1) {
      panning = true;
      lastPan = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0) return;
    const w = camera.screenToWorld(e.offsetX, e.offsetY, view.currentProjection);

    if (e.shiftKey) {
      const hit = world.buildingAt(w.x, w.y);
      if (hit && world.remove(hit.id)) view.markBuildingsDirty();
      return;
    }

    if (selectedType && world.place(selectedType, w).ok) {
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
    if (e.key === 'Escape') selectType(null);
    else if (e.key === 'c' || e.key === 'C') setOverlay(!view.showOverlay);
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
  const rTicks = el('r-ticks');

  function updateReadout(): void {
    rCount.textContent = String(world.buildings.length);
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

    if (cursor && selectedType) {
      const w = camera.screenToWorld(cursor.x, cursor.y, view.currentProjection);
      view.setGhost(selectedType, w, world.canPlace(selectedType, w).ok);
    }

    view.render();
    updateReadout();
  });
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:20px;color:#f88">${String(err)}</pre>`;
});
