import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const esbuild = require(path.join(ROOT, "WebApp", "node_modules", "esbuild"));

async function loadEsModuleViaEsbuild(relPath, outfileName) {
  const entry = path.join(ROOT, relPath);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecoloop-sync-test-"));
  const outfile = path.join(outDir, outfileName);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

const syncMod = await loadEsModuleViaEsbuild(
  "MobileApp/src/utils/overflowSync.js",
  "overflowSync.mjs",
);

const {
  eventBelongsToDriverAsTarget,
  eventBelongsToDriverAsSource,
  selectActiveDriverRoute,
  resolveLinkedOverflowEvent,
  sortPickupsForActiveRoute,
  deriveRouteState,
  formatOverflowSyncState,
} = syncMod;

function makeStop({ deliveryId, binId, routeId, status = "pending", routeName = "Test Route", lat = 13.62, lng = 123.18 }) {
  return {
    deliveryId,
    binId,
    id: binId,
    street: `Street ${binId}`,
    deliveryStatus: status,
    routeId: String(routeId),
    routeName,
    lat,
    lng,
  };
}

test("Scenario A: Two-driver overflow dispatch isolation (Driver A full -> Driver B receives; Driver A & C isolated)", () => {
  const driverA = { id: 101, assigned_vehicle_id: 11 };
  const driverB = { id: 202, assigned_vehicle_id: 22 };
  const driverC = { id: 303, assigned_vehicle_id: 33 };

  const overflowEvent = {
    id: "evt-overflow-001",
    status: "dispatched",
    source_driver_id: 101,
    source_vehicle_id: 11,
    original_driver_id: 101,
    target_driver_id: "202",
    target_vehicle_id: 22,
    assisting_vehicle_id: 22,
    route_id: 500,
    dispatched_at: "2026-11-14T10:05:00Z",
    overflow_bins: [
      { id: "BIN-O1", delivery_id: 2001, sequence: 1, lat: 13.621, lng: 123.185 },
      { id: "BIN-O2", delivery_id: 2002, sequence: 2, lat: 13.624, lng: 123.189 },
    ],
  };

  // Driver B receives incoming dispatch even with zero pre-existing routes
  const stateB = formatOverflowSyncState({
    driverId: driverB.id,
    vehicleId: driverB.assigned_vehicle_id,
    driverRoutes: [],
    overflowEvents: [overflowEvent],
    allPickups: [],
  });
  assert.equal(stateB.incomingOverflowEvent?.id, "evt-overflow-001");
  assert.equal(stateB.activeSourceOverflowEvent, null);
  assert.equal(stateB.activeOverflowEvent, null);
  assert.equal(stateB.currentRoute, null);

  // Driver A (source who reported full) sees it only as activeSourceOverflowEvent, NOT as incoming dispatch
  const stateA = formatOverflowSyncState({
    driverId: driverA.id,
    vehicleId: driverA.assigned_vehicle_id,
    driverRoutes: [{ id: 500, name: "Centro Route", status: "active", started_at: "2026-11-14T08:00:00Z" }],
    overflowEvents: [overflowEvent],
    allPickups: [],
  });
  assert.equal(stateA.incomingOverflowEvent, null);
  assert.equal(stateA.activeSourceOverflowEvent?.id, "evt-overflow-001");

  // Driver C (unrelated third driver) sees nothing at all
  const stateC = formatOverflowSyncState({
    driverId: driverC.id,
    vehicleId: driverC.assigned_vehicle_id,
    driverRoutes: [{ id: 700, name: "Concepcion Route", status: "active", started_at: "2026-11-14T08:30:00Z" }],
    overflowEvents: [overflowEvent],
    allPickups: [],
  });
  assert.equal(stateC.incomingOverflowEvent, null);
  assert.equal(stateC.activeSourceOverflowEvent, null);
  assert.equal(stateC.activeOverflowEvent, null);
  assert.equal(stateC.isOverflowRouteActive, false);

  // Vehicle fallback match when target_driver_id is unset/null
  const vehicleOnlyEvent = {
    id: "evt-vehicle-only",
    status: "pending",
    source_driver_id: 101,
    source_vehicle_id: 11,
    target_driver_id: null,
    target_vehicle_id: "22",
    overflow_bins: [{ id: "BIN-O9" }],
  };
  assert.equal(eventBelongsToDriverAsTarget(vehicleOnlyEvent, 202, 22), true);
  assert.equal(eventBelongsToDriverAsTarget(vehicleOnlyEvent, 303, 33), false);
  assert.equal(eventBelongsToDriverAsSource(vehicleOnlyEvent, 101, 11), true);
});

test("Scenario B: Home acceptance activates dedicated Overflow Assistance Route, syncs Navigate order, transitions to Landfill, and restores regular route", () => {
  const regularRoute = {
    id: 501,
    name: "Triangulo Morning Route",
    status: "active",
    started_at: "2026-11-14T07:30:00Z",
    optimization_method: "mapbox",
  };
  const overflowRoute = {
    id: 901,
    name: "Overflow Assistance Route",
    status: "active",
    started_at: "2026-11-14T10:12:00Z",
    optimization_method: "overflow_reassignment",
  };

  // Intentionally return BIN-O2 before BIN-O1 from DB to prove overflow_bins sequence is enforced
  const regularPickups = [
    makeStop({ deliveryId: 1001, binId: "BIN-R1", routeId: 501, routeName: regularRoute.name }),
    makeStop({ deliveryId: 1002, binId: "BIN-R2", routeId: 501, routeName: regularRoute.name }),
  ];
  const overflowStop2 = makeStop({ deliveryId: 2002, binId: "BIN-O2", routeId: 901, routeName: overflowRoute.name });
  const overflowStop1 = makeStop({ deliveryId: 2001, binId: "BIN-O1", routeId: 901, routeName: overflowRoute.name });

  const acceptedOverflowEvent = {
    id: "evt-accepted-901",
    status: "accepted",
    source_driver_id: 101,
    source_vehicle_id: 11,
    target_driver_id: 202,
    target_vehicle_id: 22,
    target_route_id: 901,
    accepted_at: "2026-11-14T10:12:00Z",
    overflow_bins: [
      { bin_id: "BIN-O1", delivery_id: 2001, sequence: 1 },
      { id: "BIN-O2", delivery_id: 2002, sequence: 2 },
    ],
  };

  // Step 1: Just accepted — Navigate must activate Route #901 with BIN-O1 first (not Route #501)
  const step1 = formatOverflowSyncState({
    driverId: 202,
    vehicleId: 22,
    driverRoutes: [regularRoute, overflowRoute],
    overflowEvents: [acceptedOverflowEvent],
    allPickups: [...regularPickups, overflowStop2, overflowStop1],
  });
  assert.equal(step1.currentRoute?.id, 901);
  assert.equal(step1.isOverflowRouteActive, true);
  assert.equal(step1.routeState, "in_progress");
  assert.equal(step1.activeOverflowEvent?.id, "evt-accepted-901");
  assert.deepEqual(
    step1.routePendingPickups.map((p) => p.binId),
    ["BIN-O1", "BIN-O2"],
  );

  // Step 2: BIN-O1 completed -> Navigate advances to BIN-O2
  const step2 = formatOverflowSyncState({
    driverId: 202,
    vehicleId: 22,
    driverRoutes: [regularRoute, overflowRoute],
    overflowEvents: [acceptedOverflowEvent],
    allPickups: [
      ...regularPickups,
      overflowStop2,
      { ...overflowStop1, deliveryStatus: "completed" },
    ],
  });
  assert.equal(step2.currentRoute?.id, 901);
  assert.deepEqual(
    step2.routePendingPickups.map((p) => p.binId),
    ["BIN-O2"],
  );
  assert.equal(step2.routeAssignedPickups.length, 2);

  // Step 3: BIN-O2 completed -> Route #901 remains active with 0 pending stops so Navigate transitions to SWMO Landfill
  const step3 = formatOverflowSyncState({
    driverId: 202,
    vehicleId: 22,
    driverRoutes: [regularRoute, overflowRoute],
    overflowEvents: [acceptedOverflowEvent],
    allPickups: [
      ...regularPickups,
      { ...overflowStop2, deliveryStatus: "completed" },
      { ...overflowStop1, deliveryStatus: "completed" },
    ],
  });
  assert.equal(step3.currentRoute?.id, 901);
  assert.equal(step3.isOverflowRouteActive, true);
  assert.equal(step3.routePendingPickups.length, 0);
  assert.equal(step3.routeAssignedPickups.length, 2);

  // Step 4: Driver unloads at Landfill and completes Overflow Route #901 -> Regular Route #501 automatically resumes
  const step4 = formatOverflowSyncState({
    driverId: 202,
    vehicleId: 22,
    driverRoutes: [regularRoute, { ...overflowRoute, status: "completed" }],
    overflowEvents: [{ ...acceptedOverflowEvent, status: "completed" }],
    allPickups: [
      ...regularPickups,
      { ...overflowStop2, deliveryStatus: "completed" },
      { ...overflowStop1, deliveryStatus: "completed" },
    ],
  });
  assert.equal(step4.currentRoute?.id, 501);
  assert.equal(step4.isOverflowRouteActive, false);
  assert.equal(step4.activeOverflowEvent, null);
  assert.deepEqual(
    step4.routePendingPickups.map((p) => p.binId),
    ["BIN-R1", "BIN-R2"],
  );
});

test("Scenario C: Sequence sorting fallback, status derivation, and legacy metadata compatibility", () => {
  const legacyEvent = {
    id: "evt-legacy",
    status: "accepted",
    target_driver_id: 202,
    overflow_bins: [
      { id: "BIN-10", _meta: { target_route_id: 888 }, sequence: 1 },
      { id: "BIN-20", _meta: { target_route_id: 888 }, sequence: 2 },
    ],
  };
  const legacyRoute = { id: 888, name: "Overflow Assistance Route", status: "active", optimization_method: null };
  const routePicked = selectActiveDriverRoute([legacyRoute], [legacyEvent], []);
  assert.equal(routePicked?.id, 888);
  assert.equal(resolveLinkedOverflowEvent(routePicked, [legacyEvent], [])?.id, "evt-legacy");
  assert.equal(deriveRouteState(legacyRoute), "accepted");
  assert.equal(deriveRouteState({ ...legacyRoute, started_at: "2026-11-14T11:00:00Z" }), "in_progress");

  const sorted = sortPickupsForActiveRoute(
    [
      makeStop({ deliveryId: 30, binId: "BIN-20", routeId: 888 }),
      makeStop({ deliveryId: 10, binId: "BIN-10", routeId: 888 }),
    ],
    legacyEvent,
  );
  assert.deepEqual(
    sorted.map((s) => s.binId),
    ["BIN-10", "BIN-20"],
  );
});

test("Scenario D: SQL migration, RLS policies, RPCs, WebApp hook, and MobileApp screen wiring contracts", () => {
  const migrationSql = fs.readFileSync(
    path.join(ROOT, "supabase", "migrations", "20261114224000_fix_overflow_delivery_and_nav_sync.sql"),
    "utf8",
  );
  const pickupContextSrc = fs.readFileSync(
    path.join(ROOT, "MobileApp", "src", "context", "PickupContext.js"),
    "utf8",
  );
  const homeScreenSrc = fs.readFileSync(
    path.join(ROOT, "MobileApp", "src", "screens", "HomeScreen.js"),
    "utf8",
  );
  const mapNavSrc = fs.readFileSync(
    path.join(ROOT, "MobileApp", "src", "screens", "MapNavigateScreen.js"),
    "utf8",
  );
  const webHookSrc = fs.readFileSync(
    path.join(ROOT, "WebApp", "src", "hooks", "useOverflowDispatch.ts"),
    "utf8",
  );

  // SQL contracts: schema columns, SECURITY DEFINER RPCs, RLS policies, Realtime publication, non-destructive accept_overflow_event
  assert.match(migrationSql, /add column if not exists target_route_id bigint references public\.routes\(id\)/i);
  assert.match(migrationSql, /create or replace function public\.current_driver_id\(\)/i);
  assert.match(migrationSql, /create or replace function public\.get_overflow_candidate_fleet\(/i);
  assert.match(migrationSql, /create policy "?overflow_events_read_authenticated"?[\s\S]*target_driver_id[\s\S]*public\.current_driver_id\(\)/i);
  assert.match(migrationSql, /alter publication supabase_realtime add table public\.overflow_events/i);
  assert.match(migrationSql, /coalesce\(optimization_method, ''\) in \('overflow_reassignment', 'dynamic-reassignment\+mapbox'\)/i);
  assert.match(migrationSql, /Not authorized to accept this overflow event/i);
  assert.match(migrationSql, /assigned to a different driver/i);
  assert.match(migrationSql, /for update/i);

  // PickupContext contracts: unconditional overflow_events query, Realtime subscription, AppState foreground reload, driver-scoped cache
  assert.match(pickupContextSrc, /from\("overflow_events"\)/);
  assert.doesNotMatch(pickupContextSrc, /assignedRouteIds\.length\s*\?\s*await supabase[\s\S]*from\("overflow_events"\)/);
  assert.match(pickupContextSrc, /table:\s*"overflow_events"/);
  assert.match(pickupContextSrc, /AppState\.addEventListener\("change"/);
  assert.match(pickupContextSrc, /String\(parsed\?\.driverId \?\? ""\) !== String\(driver\.id\)/);
  assert.match(pickupContextSrc, /acceptOverflowDispatch/);
  assert.match(pickupContextSrc, /declineOverflowDispatch/);

  // HomeScreen & MapNavigateScreen contracts: single shared context state + focus reload + no duplicate pickActiveRoute
  assert.match(homeScreenSrc, /usePickups\(\)/);
  assert.match(homeScreenSrc, /acceptOverflowDispatch/);
  assert.match(homeScreenSrc, /useFocusEffect/);
  assert.match(homeScreenSrc, /get_overflow_candidate_fleet/);

  assert.match(mapNavSrc, /useFocusEffect/);
  assert.match(mapNavSrc, /routePendingPickups/);
  assert.match(mapNavSrc, /isOverflowRouteActive/);
  assert.doesNotMatch(mapNavSrc, /function pickActiveRoute/);
  assert.match(mapNavSrc, /AppState\.addEventListener\("change"[\s\S]*reloadPickups/);

  // WebApp hook contracts: route-fallback driver resolution, ID normalization, no partial client fallback on accept RPC error
  assert.match(webHookSrc, /const normalizeIdString =/);
  assert.match(webHookSrc, /const resolveDriverForVehicle =/);
  assert.match(webHookSrc, /supabase\.rpc\("accept_overflow_event"/);
  assert.doesNotMatch(webHookSrc, /function isMissingRpcError/);
});
