import { Application } from 'pixi.js';
import {
  COHERENCE_THRESHOLD,
  dateline,
  World,
  WORLD_SIZE,
  buildingType,
  placeableTypes,
  ageThatUnlocks,
  NEED_LABELS,
  NEED_SHORT,
  temperOf,
  type BuildingFamily,
  planRoads,
  type PlanKind,
  type RoadClass,
  type Vec2,
} from '../sim';
import { Camera } from '../render/camera';
import { CHARACTER_COLOURS, CHARACTER_LABELS } from '../render/palette';
import { WorldView } from '../render/worldView';
import type { ViewMode } from '../render/projection';
import { seedRivalTown, seedTestTown } from './testTown';

const SIM_TICK_MS = 100;

/**
 * How near a road a building has to be before it snaps to its frontage, and how
 * far back from the kerb it then sits (design/05 §7). Placing near a road is a
 * deliberate act, so the alignment is exact; placing away from one is not.
 */
const FRONTAGE_SNAP = 26;
const SETBACK = 1.6;
const FAMILY_ORDER: BuildingFamily[] = ['economic', 'civic', 'military', 'residential'];
const FAMILY_LABELS: Record<BuildingFamily, string> = {
  economic: 'Economic',
  civic: 'Civic',
  military: 'Military',
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

  // A test seam. `scripts/trial.mjs` exercises the simulation headlessly, but
  // some questions — does a campaign read on screen? — can only be answered by
  // driving the real build, and a browser harness cannot place a keep on a
  // contested frontier by clicking at a guessed pixel.
  Object.assign(window, { __toy: { world, camera, view } });

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
  type TerraMode = 'raise' | 'lower' | 'level';
  let terra: TerraMode | null = null;
  let plan: PlanKind | null = null;
  let planAngle = 0;
  const PLAN_SIZE = 105;
  const BRUSH_RADIUS = 26;
  const BRUSH_STRENGTH = 1.5;
  let roadClass: RoadClass | null = null;
  let roadPoints: Vec2[] = [];
  let paused = false;
  let cursor: { x: number; y: number } | null = null;
  let warbandTool = false;
  let selectedBand: number | null = null;

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

      // What it costs and what it needs, on the button. Building is spending,
      // and a menu that hides the price is not a resource game.
      const cost = document.createElement('span');
      cost.className = 'cost';

      btn.append(swatch, label, cost);
      btn.addEventListener('click', () => {
        if (btn.hasAttribute('disabled')) return;
        selectType(type.id);
      });
      paletteHost.appendChild(btn);
      itemButtons.set(type.id, btn);
    }
  }

  /** Put the warband tool down without disturbing whatever picked it up. */
  function dropWarbandTool(): void {
    if (!warbandTool) return;
    warbandTool = false;
    selectedBand = null;
    btnWarband.setAttribute('aria-pressed', 'false');
    view.setSelectedBand(null);
  }

  function selectType(id: string | null): void {
    if (id) {
      dropWarbandTool();
      setRoadClass(null);
      paving = false;
      btnPave?.setAttribute('aria-pressed', 'false');
      terra = null;
      for (const btn of Object.values(terraButtons ?? {})) {
        btn.setAttribute('aria-pressed', 'false');
      }
      plan = null;
      for (const btn of Object.values(planButtons ?? {})) {
        btn.setAttribute('aria-pressed', 'false');
      }
    }
    selectedType = selectedType === id ? null : id;
    for (const [typeId, btn] of itemButtons) {
      btn.setAttribute('aria-pressed', String(typeId === selectedType));
    }
    if (!selectedType) view.setGhost(null, null, false);
  }

  /**
   * Keep every build button honest about price and affordability.
   *
   * Recomputed on a slow cadence rather than every frame: stocks move at a few
   * units a second and the DOM cost of rewriting twenty-five buttons is not
   * worth paying sixty times a second (see design/07 — the same lesson the
   * quarter labels taught).
   */
  function refreshPalette(): void {
    const stocks = world.economy.stocks;
    const signature =
      `${Math.floor(stocks.timber)},${Math.floor(stocks.stone)},` +
      `${Math.floor(stocks.iron)},${Math.floor(stocks.food)},` +
      `${Math.floor(stocks.tools)},${world.ages.index}`;
    if (signature === paletteState) return;
    paletteState = signature;

    const unlocked = world.ages.unlocked();

    for (const [typeId, btn] of itemButtons) {
      const type = buildingType(typeId);
      const short = type.cost ? world.economy.shortfall(type.cost) : [];
      const open = unlocked.has(typeId);
      const box = btn.querySelector('.cost');
      if (!box) continue;

      const bits: string[] = [];
      for (const [res, n] of Object.entries(type.cost ?? {})) {
        if (!n) continue;
        const lacking = short.includes(res as 'timber');
        bits.push(`<span class="${lacking ? 'short' : ''}">${n} ${res}</span>`);
      }
      if (type.jobs) bits.push(`<span class="jobs">${type.jobs} jobs</span>`);
      if (type.houses) bits.push(`<span class="jobs">+${type.houses} people</span>`);
      // What need it answers, because "a market cross" does not otherwise say
      // that it is the thing forty houses are waiting for.
      for (const need of type.serves ?? []) {
        bits.push(`<span class="serves">${NEED_SHORT[need]}</span>`);
      }
      if (bits.length === 0) bits.push('<span>free</span>');
      // The age gate replaces the price rather than joining it: what a keep
      // costs is not yet the player's problem.
      if (!open) {
        const at = ageThatUnlocks(typeId);
        bits.length = 0;
        bits.push(`<span class="locked">${at ? at.name : 'Later'}</span>`);
      }

      const html = bits.join('');
      if (box.innerHTML !== html) box.innerHTML = html;

      const buildable = open && short.length === 0;
      btn.classList.toggle('locked', !open);
      btn.toggleAttribute('disabled', !buildable);
      if (!buildable && selectedType === typeId) selectType(null);
    }
  }

  let paletteState = '';

  // ---- Controls ----------------------------------------------------------
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  const btnIso = el<HTMLButtonElement>('view-iso');
  const btnPlan = el<HTMLButtonElement>('view-plan');
  const btnOverlay = el<HTMLButtonElement>('toggle-overlay');
  const btnStreets = el<HTMLButtonElement>('toggle-streets');
  const btnSupply = el<HTMLButtonElement>('toggle-supply');
  const btnPause = el<HTMLButtonElement>('toggle-pause');

  function setView(mode: ViewMode): void {
    view.setViewMode(mode);
    btnIso.setAttribute('aria-pressed', String(mode === 'iso'));
    btnPlan.setAttribute('aria-pressed', String(mode === 'plan'));
  }

  const btnLand = el<HTMLButtonElement>('toggle-land');

  /** The two overlays are one layer, so picking one puts the other down. */
  function setOverlay(mode: 'character' | 'land' | null): void {
    view.showOverlay = mode !== null;
    if (mode) view.overlayMode = mode;
    view.markOverlayDirty();
    btnOverlay.setAttribute('aria-pressed', String(mode === 'character'));
    btnLand.setAttribute('aria-pressed', String(mode === 'land'));
  }

  const overlayNow = (): 'character' | 'land' | null =>
    view.showOverlay ? view.overlayMode : null;

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

  const terraButtons: Record<TerraMode, HTMLButtonElement> = {
    raise: el<HTMLButtonElement>('terra-raise'),
    lower: el<HTMLButtonElement>('terra-lower'),
    level: el<HTMLButtonElement>('terra-level'),
  };

  function setTerra(mode: TerraMode | null): void {
    if (mode) dropWarbandTool();
    terra = mode;
    for (const [k, btn] of Object.entries(terraButtons)) {
      btn.setAttribute('aria-pressed', String(k === mode));
    }
    if (mode) {
      selectType(null);
      setRoadClass(null);
      setPaving(false);
      terra = mode;
      for (const [k, btn] of Object.entries(terraButtons)) {
        btn.setAttribute('aria-pressed', String(k === mode));
      }
    }
    view.clearGhost();
  }

  for (const [mode, btn] of Object.entries(terraButtons)) {
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () =>
      setTerra(terra === mode ? null : (mode as TerraMode)),
    );
  }

  function applyBrush(world: World, at: Vec2): void {
    if (!terra) return;
    world.sculpt(
      {
        at,
        radius: BRUSH_RADIUS,
        amount: terra === 'lower' ? -BRUSH_STRENGTH : BRUSH_STRENGTH,
      },
      terra === 'level' ? 'level' : 'raise',
    );
  }

  const btnFlow = el<HTMLButtonElement>('toggle-flow');
  btnFlow.addEventListener('click', () => {
    world.useFlow = !world.useFlow;
    world.invalidateField();
    btnFlow.setAttribute('aria-pressed', String(world.useFlow));
  });

  const planButtons: Record<string, HTMLButtonElement> = {
    crescent: el<HTMLButtonElement>('plan-crescent'),
    square: el<HTMLButtonElement>('plan-square'),
    grid: el<HTMLButtonElement>('plan-grid'),
  };

  function setPlan(kind: PlanKind | null): void {
    if (kind) dropWarbandTool();
    plan = kind;
    for (const [k, btn] of Object.entries(planButtons)) {
      btn.setAttribute('aria-pressed', String(k === kind));
    }
    view.clearGhost();
    if (kind) {
      selectType(null);
      setRoadClass(null);
      setPaving(false);
      setTerra(null);
      plan = kind;
      for (const [k, btn] of Object.entries(planButtons)) {
        btn.setAttribute('aria-pressed', String(k === kind));
      }
    }
  }

  for (const [kind, btn] of Object.entries(planButtons)) {
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () =>
      setPlan(plan === kind ? null : (kind as PlanKind)),
    );
  }

  const btnProblems = el<HTMLButtonElement>('toggle-problems');
  btnProblems.addEventListener('click', () => {
    view.showProblems = !view.showProblems;
    btnProblems.setAttribute('aria-pressed', String(view.showProblems));
  });

  const btnBorders = el<HTMLButtonElement>('toggle-borders');
  btnBorders.addEventListener('click', () => {
    view.showBorders = !view.showBorders;
    btnBorders.setAttribute('aria-pressed', String(view.showBorders));
  });

  const btnPave = el<HTMLButtonElement>('tool-pave');
  btnPave.setAttribute('aria-pressed', 'false');
  btnPave.addEventListener('click', () => setPaving(!paving));

  /**
   * One tool for the whole military game (design/01).
   *
   * Click a keep to raise a column, click a column to pick it up, click ground to
   * send it. There is no unit roster, no stance, no formation and no combat
   * interface, because the decisions this design cares about were all made
   * earlier: where you built, whether you could afford an army, and whether the
   * ground you are marching over is integrated enough to feed it.
   */
  const btnWarband = el<HTMLButtonElement>('tool-warband');
  btnWarband.setAttribute('aria-pressed', 'false');

  function setWarband(on: boolean): void {
    warbandTool = on;
    if (!on) selectedBand = null;
    btnWarband.setAttribute('aria-pressed', String(on));
    view.setSelectedBand(on ? selectedBand : null);
    if (on) {
      selectType(null);
      setRoadClass(null);
      setPaving(false);
      setTerra(null);
      setPlan(null);
      warbandTool = true;
      btnWarband.setAttribute('aria-pressed', 'true');
      view.showBorders = true;
      btnBorders.setAttribute('aria-pressed', 'true');
    }
  }

  btnWarband.addEventListener('click', () => setWarband(!warbandTool));

  // The keys panel used to sit where the chronicle now lives, so it folds away.
  const btnHint = el<HTMLButtonElement>('toggle-hint');
  const hintPanel = el('hint');
  btnHint.addEventListener('click', () => {
    const on = hintPanel.style.display !== 'block';
    hintPanel.style.display = on ? 'block' : 'none';
    btnHint.setAttribute('aria-pressed', String(on));
  });

  /** Resolve a click while the warband tool is up. Returns a note for the hint. */
  function warbandClick(at: Vec2): void {
    // 1. A column of yours under the cursor becomes the selection.
    const mine = world.military.bandNear(at, 22, 0);
    if (mine && mine.id !== selectedBand) {
      selectedBand = mine.id;
      view.setSelectedBand(selectedBand);
      return;
    }

    // 2. With one selected, anywhere else is an order to march.
    if (selectedBand !== null) {
      const band = world.military.warbands.find((w) => w.id === selectedBand);
      if (band && band.owner === 0) {
        world.orderWarband(band, at);
        return;
      }
      selectedBand = null;
      view.setSelectedBand(null);
    }

    // 3. Otherwise, a keep in reach raises a new column.
    const raised = world.muster(at);
    if (raised) {
      selectedBand = raised.id;
      view.setSelectedBand(selectedBand);
    }
  }

  const roadButtons: Record<RoadClass, HTMLButtonElement> = {
    lane: el<HTMLButtonElement>('road-lane'),
    street: el<HTMLButtonElement>('road-street'),
    high: el<HTMLButtonElement>('road-high'),
  };

  function setPaving(on: boolean): void {
    if (on) dropWarbandTool();
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
    if (cls) dropWarbandTool();
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

  btnOverlay.addEventListener('click', () =>
    setOverlay(overlayNow() === 'character' ? null : 'character'),
  );
  btnLand.addEventListener('click', () => setOverlay(overlayNow() === 'land' ? null : 'land'));
  btnStreets.addEventListener('click', () => setStreets(!view.showStreets));
  btnSupply.addEventListener('click', () => {
    view.showSupply = !view.showSupply;
    btnSupply.setAttribute('aria-pressed', String(view.showSupply));
  });
  btnPause.addEventListener('click', () => setPaused(!paused));

  el('seed-town').addEventListener('click', () => {
    // The scenario town is a given, not something the player paid for, so it is
    // granted its materials — with enough left over to actually try a plan.
    world.economy.stocks.timber += 1400;
    world.economy.stocks.stone += 1400;
    world.economy.stocks.iron += 400;
    world.economy.stocks.tools += 300;
    seedTestTown(world);
    seedRivalTown(world);
    // A scenario town arrives with people already in it. Without this the whole
    // place starts empty, every works reads as unstaffed, and the alerts layer
    // lights up like a Christmas tree over a town that is fine.
    world.populace.settle(90);
    world.rebuildFabric();
    view.markBuildingsDirty();
  });

  el('clear-town').addEventListener('click', () => {
    for (const b of [...world.buildings]) world.remove(b.id);
    // Clear means start over, so the arc starts over too. Ages never regress
    // during play — a town that loses its market does not become a hamlet again
    // — but an empty field with the whole catalogue open is not a game.
    world.ages.index = 0;
    view.markBuildingsDirty();
  });

  // ---- Input -------------------------------------------------------------
  const canvas = app.canvas;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  let panning = false;
  let sculpting = false;
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

    if (warbandTool) {
      warbandClick(w);
      return;
    }

    if (plan) {
      if (world.applyPlan({ kind: plan, at: w, size: PLAN_SIZE, angle: planAngle })) {
        world.rebuildFabric();
        view.markBuildingsDirty();
      }
      return;
    }

    if (terra) {
      sculpting = true;
      applyBrush(world, w);
      canvas.setPointerCapture(e.pointerId);
      return;
    }

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
    cursor = { x: e.offsetX, y: e.offsetY };

    if (sculpting && terra) {
      applyBrush(world, camera.screenToWorld(e.offsetX, e.offsetY, view.currentProjection));
      return;
    }

    if (panning) {
      camera.panByScreen(e.clientX - lastPan.x, e.clientY - lastPan.y);
      lastPan = { x: e.clientX, y: e.clientY };
      return;
    }
    cursor = { x: e.offsetX, y: e.offsetY };
  });

  const endPan = (e: PointerEvent) => {
    if (sculpting) {
      sculpting = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    }
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
    if (e.key === '[' || e.key === ']') {
      planAngle += e.key === '[' ? -Math.PI / 12 : Math.PI / 12;
      return;
    }
    if (e.key === 'Escape') {
      if (warbandTool) setWarband(false);
      else if (plan) setPlan(null);
      else if (terra) setTerra(null);
      else if (paving) setPaving(false);
      else if (roadClass) setRoadClass(null);
      else selectType(null);
    } else if (e.key === 'Enter') finishRoad();
    else if (e.key === 'c' || e.key === 'C')
      setOverlay(overlayNow() === 'character' ? null : 'character');
    else if (e.key === 'l' || e.key === 'L')
      setOverlay(overlayNow() === 'land' ? null : 'land');
    else if (e.key === 's' || e.key === 'S') setStreets(!view.showStreets);
    else if (e.key === 'v' || e.key === 'V') setView(view.viewMode === 'iso' ? 'plan' : 'iso');
    else if (e.key === 'w' || e.key === 'W') setWarband(!warbandTool);
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
  const rRender = el('r-render');
  const rTerritory = el('r-territory');
  const rTerrDetail = el('r-terrdetail');
  const sTimber = el('s-timber');
  const sStone = el('s-stone');
  const sIron = el('s-iron');
  const sFood = el('s-food');
  const sOre = el('s-ore');
  const sTools = el('s-tools');
  const sJobs = el('s-jobs');
  const sPop = el('s-pop');
  const sCap = el('s-cap');
  const sWhy = el('s-why');
  const rWhen = el('r-when');
  const rRival = el('r-rival');
  const rHeld = el('r-held');
  const rBands = el('r-bands');
  const rUpkeep = el('r-upkeep');
  const rConquest = el('r-conquest');
  const rStreet = el('r-street');
  const rGround = el('r-ground');
  const rMill = el('r-mill');
  const rAge = el('r-age');
  const goalPanel = el('goal');
  const goalTitle = el('goal-title');
  const goalPct = el('goal-pct');
  const goalBar = el('goal-bar').firstElementChild as HTMLElement;
  const goalList = el('goal-list');
  const goalNeeds = el('goal-needs');
  let goalState = '';
  el('r-townname').textContent = world.name;
  let townEvery = -Infinity;
  let renderMs = 0;
  const rTicks = el('r-ticks');

  function updateReadout(): void {
    const stocks = world.economy.stocks;
    const rates = world.economy.rates;
    sTimber.textContent = String(Math.floor(stocks.timber));
    sStone.textContent = String(Math.floor(stocks.stone));
    sIron.textContent = String(Math.floor(stocks.iron));
    sFood.textContent = String(Math.floor(stocks.food));
    sOre.textContent = String(Math.floor(stocks.ore));
    sTools.textContent = String(Math.floor(stocks.tools));

    // Population, and — when it has stopped — *why*. A town that stalls with no
    // explanation is the worst thing a builder can do, so the reason is on the
    // same line as the number.
    const pop = world.populace.report;
    sPop.textContent = String(pop.population);
    sCap.textContent = String(pop.capacity);
    sWhy.textContent =
      pop.blocked === 'room'
        ? 'no housing'
        : pop.blocked === 'food'
          ? 'no surplus'
          : pop.blocked === 'leaving'
            ? 'leaving'
            : pop.blocked === 'unserved'
              ? 'poorly served'
              : '';
    sPop.parentElement!.parentElement!.classList.toggle('short', pop.blocked !== null);

    const work = world.labour.report;
    sJobs.textContent = `${work.filled}/${work.jobs}`;
    sJobs.parentElement!.parentElement!.classList.toggle(
      'short',
      work.jobs > work.filled,
    );
    // Falling stocks are flagged, since a trend matters more than a level.
    // Ore piling up with no iron coming out is the chain's signature failure —
    // a mine with no foundry in reach — so it is flagged on the *stock* rather
    // than on the rate: a growing pile is the symptom, not a falling one.
    sOre.parentElement!.classList.toggle('low', stocks.ore > 40 && rates.iron <= 0);
    sTools.parentElement!.classList.toggle('low', rates.tools <= 0 && stocks.tools < 10);
    sTimber.parentElement!.classList.toggle('low', rates.timber <= 0 && stocks.timber < 30);
    sIron.parentElement!.classList.toggle('low', rates.iron <= 0 && stocks.iron < 20);
    sStone.parentElement!.classList.toggle('low', rates.stone <= 0 && stocks.stone < 30);
    sFood.parentElement!.classList.toggle('low', rates.food < 0);

    const season = world.calendar.season;
    rWhen.textContent = `${season[0].toUpperCase()}${season.slice(1)}, year ${world.calendar.year}`;
    rWhen.classList.toggle('winter', season === 'winter');
    rRival.textContent = String(world.rivalBuilt);

    const mine = world.military.bandsOf(0);
    const theirs = world.military.bandsOf(1);
    const starving = mine.filter((b) => !b.supplied).length;
    // What our columns *are*, not only how many. Two levies and a company of
    // regulars is a different army from three levies, and the difference is
    // decided by which keeps raised them.
    const kinds = [...new Set(mine.map((b) => temperOf(b.character).name.toLowerCase()))];
    rBands.textContent = mine.length + theirs.length === 0
      ? '—'
      : `${mine.length} v ${theirs.length}` +
        (kinds.length ? ` · ${kinds.join(', ')}` : '') +
        (starving ? ` · ${starving} starving` : '');
    rBands.classList.toggle('low', starving > 0);
    rUpkeep.textContent =
      world.economy.upkeep > 0 ? `${world.economy.upkeep.toFixed(2)} food/tick` : '—';
    rConquest.textContent = `${world.razed} · ${world.captured}`;

    rCount.textContent = String(world.buildings.length);
    rStreets.textContent = `${world.roads.length} / ${world.fabric.paths.length}`;
    rPeople.textContent = String(world.crowd.people.length);

    // Scanning every cell is too slow for every frame, and it barely changes.
    // Timed rather than frame-counted, so a slow machine still updates it.
    const now = performance.now();
    if (now - townEvery > 1500) {
      townEvery = now;
      const stats = world.field.townCoherence();
      rRender.textContent = `${renderMs.toFixed(2)} ms`;
      const terr = world.territory.stats(world.buildings, world.field);
      const pct = (v: number) => Math.round(v * 100);
      rTerritory.textContent = `${terr.cells[0]} v ${terr.cells[1]}`;
      rTerrDetail.textContent =
        `coh ${pct(terr.coherence[0])}/${pct(terr.coherence[1])} · ` +
        `out ${terr.output[0].toFixed(0)}/${terr.output[1].toFixed(0)}`;
      // Ground you are standing on but have not converted. A number that keeps
      // climbing is the gilded cage of design/01 §5 forming.
      rHeld.textContent =
        terr.held[0] + terr.held[1] === 0 ? '—' : `${terr.held[0]} v ${terr.held[1]}`;
      rHeld.classList.toggle('low', terr.held[0] > terr.cells[0] * 0.3);
      rTown.textContent = stats.cells
        ? `${Math.round(stats.mean * 100)}% over ${stats.cells}`
        : '—';
    }
    rTicks.textContent = String(world.ticks);
    updateGoal();

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

    const flow = Math.round(world.terrain.flowAt(w.x, w.y));
    rGround.textContent = `${world.terrain.heightAt(w.x, w.y).toFixed(1)}m · ${flow}`;

    const mill = world.terrain.millPotentialAt(w.x, w.y);
    rMill.textContent = mill > 3 ? 'good' : mill > 1.2 ? 'possible' : '—';

    const road = world.roadNear(w, 14);
    rStreet.textContent = road?.road.name ?? '—';

    const hit = world.buildingAt(w.x, w.y);
    rBuilding.textContent = hit ? describe(hit) : '—';
  }

  /**
   * What the town is working toward, and what its households cannot reach.
   *
   * Two blocks, and the split matters. The top one is the *goal*, phrased as
   * things to build — "a chapel", "110 people" — because an objective the player
   * can read and act on without decoding anything is the whole point of having
   * ages rather than a tech tree. The bottom is what is currently wrong, counted
   * per need, and it pairs with the blue markers on the map: the panel says how
   * many, the map says where.
   *
   * Rebuilt only when the text would change. The requirements move on the needs
   * clock — every fifteen ticks at most — so rewriting this at sixty frames a
   * second would be pure waste (design/07, the quarter-label lesson).
   */
  function updateGoal(): void {
    const state = world.ages.progress(
      world.buildings,
      world.populace.report.population,
      world.needs.coverage,
    );
    const next = world.ages.next;
    const report = world.needs.report;

    const wants = world.ages.demands
      .filter((n) => report.short[n] > 0)
      .map((n) => `${report.short[n]} homes want ${NEED_LABELS[n].toLowerCase()}`);

    const signature =
      `${state.index}|${state.outstanding.join('|')}|${wants.join('|')}`;
    if (signature === goalState) return;
    goalState = signature;

    rAge.textContent = state.age.name;

    if (state.final) {
      goalTitle.textContent = `A borough. ${state.age.blurb}`;
      goalPct.textContent = '';
      goalBar.style.width = '100%';
      goalPanel.classList.add('done');
    } else {
      goalTitle.textContent = `Toward a ${next!.name.toLowerCase()} — ${next!.blurb}`;
      goalPct.textContent = `${Math.round(state.progress * 100)}%`;
      goalBar.style.width = `${Math.round(state.progress * 100)}%`;
      goalPanel.classList.remove('done');
    }

    goalList.innerHTML = state.outstanding
      .map((s) => `<span>${s}</span>`)
      .join('');
    goalNeeds.innerHTML = wants.map((s) => `<span>${s}</span>`).join('');
  }

  /**
   * A building, and how it is doing — in words.
   *
   * The one line that says why a works is not working, on the building the
   * cursor is over. Bands rather than percentages on purpose: "half fed" is
   * what you need to know and "48% fed" is a number to be optimised, which is
   * the difference this whole design turns on. The map already tells you
   * *which* building is in trouble; this says what kind of trouble.
   */
  function describe(b: ReturnType<typeof world.buildingAt> & object): string {
    const type = buildingType(b.typeId);
    const band = (v: number) =>
      v >= 0.99 ? 'fully' : v >= 0.66 ? 'mostly' : v >= 0.34 ? 'half' : v > 0.02 ? 'barely' : 'not';

    const bits: string[] = [];
    if (type.consumes) bits.push(`${band(world.supply.feedOf(b))} fed`);
    if (type.jobs) bits.push(`${band(world.labour.staffingOf(b))} staffed`);
    if (type.houses) {
      const short = world.needs.missing.get(b.id);
      bits.push(short?.length ? `wants ${short.map((n) => NEED_SHORT[n]).join(', ')}` : 'well served');
    }
    const ground = world.territory.standingAt(b.pos.x, b.pos.y);
    if (ground.standing === 'held') bits.push('on sullen ground');

    return bits.length ? `${type.name} · ${bits.join(' · ')}` : type.name;
  }

  // ---- Quarter names, drawn on the map ------------------------------------
  //
  // A place name belongs *on the place*. Putting these in a list in the corner
  // would tell you the same facts and none of the same story — this is the
  // difference between a map and a spreadsheet, and it is why they are DOM
  // rather than canvas: crisp at any zoom, and stylable like a map.
  const quarterHost = el('quarters');
  const quarterTags = new Map<number, HTMLElement>();
  let labelState = '';

  function updateQuarterLabels(): void {
    // Only touch the DOM when something actually moved.
    //
    // Repositioning seven labels every frame sounds free and is not: each write
    // invalidates style and layout for a full-screen overlay sitting on top of
    // the canvas, and it took the median frame from 9.2ms to 14.1ms while
    // leaving the *minimum* untouched — the giveaway that the cost was in
    // occasional expensive frames rather than in the renderer.
    const signature =
      `${camera.x.toFixed(1)},${camera.y.toFixed(1)},${camera.zoom.toFixed(3)},` +
      `${view.viewMode},${world.quarters.revision},${camera.viewportWidth}`;
    if (signature === labelState) return;
    labelState = signature;

    const alive = new Set<number>();

    for (const q of world.quarters.list) {
      alive.add(q.id);

      let tag = quarterTags.get(q.id);
      if (!tag) {
        tag = document.createElement('div');
        tag.className = 'quarter';
        quarterHost.appendChild(tag);
        quarterTags.set(q.id, tag);
        // A beat before fading in, so a quarter *arrives* rather than blinking
        // into existence. It is one line and it makes naming feel like an event.
        requestAnimationFrame(() => tag?.classList.add('on'));
      }

      const label =
        `${q.name}<small>${CHARACTER_LABELS[q.character]} · since year ${q.since}</small>`;
      if (tag.dataset.label !== label) {
        tag.innerHTML = label;
        tag.dataset.label = label;
      }
      tag.classList.toggle('rival', q.owner !== 0);

      const h = world.terrain.heightAt(q.centre.x, q.centre.y);
      const p = view.currentProjection.project(q.centre.x, q.centre.y, h);
      const sx = p.x * camera.zoom + (camera.viewportWidth / 2 - camera.x * camera.zoom);
      const sy = p.y * camera.zoom + (camera.viewportHeight / 2 - camera.y * camera.zoom);

      // Map labels do not scale with the map, but a small quarter's name is
      // clutter from a long way out, so it drops away as you zoom back.
      const worth = q.cells * camera.zoom > 260;
      // Keep clear of the side panels, which the labels would otherwise slide
      // under — half a place name disappearing behind a button reads as a bug.
      const onScreen =
        sx > 244 &&
        sy > 8 &&
        sx < camera.viewportWidth - 272 &&
        sy < camera.viewportHeight - 24;

      tag.style.display = worth && onScreen ? '' : 'none';
      tag.style.left = `${Math.round(sx)}px`;
      tag.style.top = `${Math.round(sy)}px`;
    }

    for (const [id, tag] of quarterTags) {
      if (alive.has(id)) continue;
      tag.remove();
      quarterTags.delete(id);
    }
  }

  // ---- The chronicle -------------------------------------------------------
  const chronicleList = el('chronicle-list');
  let chronicleVersion = -1;

  function updateChronicle(): void {
    if (world.chronicle.version === chronicleVersion) return;
    const first = chronicleVersion < 0;
    chronicleVersion = world.chronicle.version;

    chronicleList.replaceChildren();
    const entries = world.chronicle.latest(40);

    entries.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = `entry ${entry.kind}`;
      // The newest line is lifted, so a new event is noticed without a popup.
      if (i === 0 && !first) row.classList.add('fresh');

      const when = document.createElement('div');
      when.className = 'when';
      when.textContent = dateline(entry);

      const what = document.createElement('div');
      what.className = 'what';
      what.textContent = entry.text;

      row.append(when, what);
      chronicleList.append(row);
    });
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

    if (cursor && plan) {
      const w = camera.screenToWorld(cursor.x, cursor.y, view.currentProjection);
      view.clearGhost();
      for (const r of planRoads({ kind: plan, at: w, size: PLAN_SIZE, angle: planAngle })) {
        view.setRoadPreview(r.points, r.cls);
      }
    } else if (cursor && paving) {
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
      // What this site is actually worth, before you pay for it. Siting a works
      // used to be a guess; now the catchment it would draw on is drawn under
      // the cursor, and the reach it needs workers from is drawn round it.
      view.setSitePreview(selectedType, resolved.pos);
    } else {
      view.setSitePreview(null, null);
    }

    refreshPalette();

    const dt = ticker.deltaMS / 1000;
    if (!paused) world.updatePeople(dt);

    // CPU cost of a frame, which is the part that is ours to fix. Deliberately
    // separate from frame rate: this machine renders in software, so fps here
    // measures the absence of a GPU rather than anything about the code.
    const t0 = performance.now();
    view.render(paused ? 0 : dt);
    renderMs += (performance.now() - t0 - renderMs) * 0.08;

    updateReadout();
    updateQuarterLabels();
    updateChronicle();
  });
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:20px;color:#f88">${String(err)}</pre>`;
});
