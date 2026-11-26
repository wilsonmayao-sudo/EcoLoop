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
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecoloop-dispatch-test-"));
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
  formatOverflowSyncState,
} = syncMod;

const migrationSql = fs.readFileSync(
  path.join(ROOT, "supabase", "migrations", "20261127000000_fix_dispatch_assignment_delivery_and_sync.sql"),
  "utf8",
);
const useLiveDataSrc = fs.readFileSync(path.join(ROOT, "WebApp", "src", "hooks", "useLiveData.ts"), "utf8");
const useOverflowDispatchSrc = fs.readFileSync(path.join(ROOT, "WebApp", "src", "hooks", "useOverflowDispatch.ts"), "utf8");
const liveMonitoringSrc = fs.readFileSync(path.join(ROOT, "WebApp", "src", "pages", "LiveMonitoring.tsx"), "utf8");
const pickupContextSrc = fs.readFileSync(path.join(ROOT, "MobileApp", "src", "context", "PickupContext.js"), "utf8");
const notificationContextSrc = fs.readFileSync(path.join(ROOT, "MobileApp", "src", "context", "NotificationContext.js"), "utf8");
const offlineSyncSrc = fs.readFileSync(path.join(ROOT, "MobileApp", "src", "services", "offlineSync.js"), "utf8");
const authContextSrc = fs.readFileSync(path.join(ROOT, "MobileApp", "src", "context", "AuthContext.js"), "utf8");
const homeScreenSrc = fs.readFileSync(path.join(ROOT, "MobileApp", "src", "screens", "HomeScreen.js"), "utf8");
const mapNavSrc = fs.readFileSync(path.join(ROOT, "MobileApp", "src", "screens", "MapNavigateScreen.js"), "utf8");
const notificationsScreenSrc = fs.readFileSync(path.join(ROOT, "MobileApp", "src", "screens", "NotificationsScreen.js"), "utf8");

// Mirror NotificationContext visibility predicate so we verify exact recipient isolation
function notificationVisibleToUser(row, authUserId, appRole, unreadOnly = false) {
  if (!row || (unreadOnly && row.read)) return false;
  const addressedUserId = row.user_auth_id ?? row.user_id ?? null;
  if (addressedUserId) return String(addressedUserId) === String(authUserId);
  if (row.role != null && row.role !== "") return row.role === appRole;
  return false;
}

test("Scenario 1: Normal dispatch (Driver A requests -> Dispatcher assigns Truck B -> Driver B notified & accepts -> Navigate & Dashboard sync)", () => {
  // 1. Atomic creation & assignment RPC contracts exist in SQL and WebApp/MobileApp callers
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.create_overflow_dispatch\(/i);
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.dispatch_overflow_event\(/i);
  assert.match(useOverflowDispatchSrc, /supabase\.rpc\("create_overflow_dispatch"/);
  assert.match(useOverflowDispatchSrc, /supabase\.rpc\("dispatch_overflow_event"/);
  assert.match(homeScreenSrc, /supabase\.rpc\("create_overflow_dispatch"/);

  // 2. Notification enum uses valid 'assignment' category (not invalid 'truck') and addresses auth_user_id
  assert.doesNotMatch(migrationSql, /'truck'::public\.notification_category/i);
  assert.match(migrationSql, /'assignment'::public\.notification_category/i);

  // 3. Simulate Driver A requesting assistance -> Dispatcher assigning Truck B -> Driver B receiving & accepting
  const driverA = { id: 101, authUserId: "auth-driver-a", vehicleId: 11 };
  const driverB = { id: 202, authUserId: "auth-driver-b", vehicleId: 22 };

  const dispatchedEvent = {
    id: "evt-normal-1",
    status: "dispatched",
    source_driver_id: String(driverA.id),
    source_driver_auth_user_id: driverA.authUserId,
    source_vehicle_id: String(driverA.vehicleId),
    source_route_id: "500",
    target_driver_id: String(driverB.id),
    target_driver_auth_user_id: driverB.authUserId,
    target_vehicle_id: String(driverB.vehicleId),
    dispatched_at: "2026-11-27T08:00:00Z",
    driver_notified_at: "2026-11-27T08:00:00Z",
    bins_count: 2,
    overflow_bins: [
      { bin_id: 701, stop_order: 1, lat: 13.621, lng: 123.185, location: "Stop 1" },
      { bin_id: 702, stop_order: 2, lat: 13.624, lng: 123.189, location: "Stop 2" },
    ],
    reassignment_metadata: {
      source_vehicle_label: "Truck A",
      source_driver_name: "Driver A",
      source_route_name: "Area 1 Morning",
    },
  };

  const stateB = formatOverflowSyncState({
    driverId: driverB.id,
    vehicleId: driverB.vehicleId,
    authUserId: driverB.authUserId,
    driverRoutes: [],
    overflowEvents: [dispatchedEvent],
    allPickups: [],
  });
  assert.equal(stateB.incomingOverflowEvent?.id, "evt-normal-1");
  assert.equal(stateB.pendingOverflowEvents.length, 1);

  // After Driver B accepts, Navigate receives active Overflow Assistance Route and ordered stops
  const acceptedEvent = { ...dispatchedEvent, status: "accepted", target_route_id: 901, accepted_at: "2026-11-27T08:01:00Z" };
  const overflowRoute = { id: 901, name: "Overflow Assistance Route", status: "active", started_at: "2026-11-27T08:01:00Z", optimization_method: "overflow_reassignment" };
  const pickups = [
    { deliveryId: 8002, binId: "702", routeId: "901", deliveryStatus: "assigned", stopOrder: 2 },
    { deliveryId: 8001, binId: "701", routeId: "901", deliveryStatus: "assigned", stopOrder: 1 },
  ];
  const acceptedStateB = formatOverflowSyncState({
    driverId: driverB.id,
    vehicleId: driverB.vehicleId,
    authUserId: driverB.authUserId,
    driverRoutes: [overflowRoute],
    overflowEvents: [acceptedEvent],
    allPickups: pickups,
  });
  assert.equal(acceptedStateB.currentRoute?.id, 901);
  assert.equal(acceptedStateB.isOverflowRouteActive, true);
  assert.deepEqual(acceptedStateB.routePendingPickups.map((p) => p.binId), ["701", "702"]);

  // Dashboard status labels cover the full lifecycle
  assert.match(liveMonitoringSrc, /Awaiting Truck Assignment/);
  assert.match(liveMonitoringSrc, /Driver Notified/);
  assert.match(liveMonitoringSrc, /Truck Assigned/);
  assert.match(liveMonitoringSrc, /Driver Accepted/);
  assert.match(liveMonitoringSrc, /Assistance in Progress/);
  assert.match(liveMonitoringSrc, /Assistance Completed/);
  assert.match(liveMonitoringSrc, /Declined/);
  assert.match(useLiveDataSrc, /fetchOverflowEventsSafe\(\)/);
  assert.match(useLiveDataSrc, /load_percent/);
});

test("Scenario 2: Missed notification & app closed (Dispatcher assigns offline Truck B -> Driver B reopens app -> assignment appears & can be accepted)", () => {
  // Dispatcher manual UI allows assigning a driver whose app is closed / GPS stale
  assert.match(useOverflowDispatchSrc, /manualAssignment:\s*!isAuto/);
  assert.match(liveMonitoringSrc, /isOfflineOrUnverifiedOnly/);

  // AuthContext brings 'offline' driver to 'available' on app launch/session restore, and SQL accept allows self-acceptance
  assert.match(authContextSrc, /String\(data\.status \?\? ""\)\.toLowerCase\(\) === "offline"/);
  assert.match(migrationSql, /IF v_driver\.status::text IN \('available', 'offline'\) THEN/i);
  assert.match(migrationSql, /up\.auth_user_id = v_driver\.auth_user_id/i);

  // Even with zero notifications delivered locally, PickupContext queries overflow_events directly on boot/focus/session restore
  assert.match(pickupContextSrc, /session\?\.access_token/);
  assert.match(pickupContextSrc, /AppState\.addEventListener\("change"/);
  assert.match(homeScreenSrc, /pendingAssistanceList\.length > 0/);
  assert.match(mapNavSrc, /pendingAssistanceEvent/);
  assert.match(notificationsScreenSrc, /navigation\?\.navigate\?\.\("Main",\s*\{\s*screen:\s*"Home"\s*\}\)/);

  // Also ensure completePickup does not prematurely close overflow_events before completeRoute
  const completePickupBlock = pickupContextSrc.slice(
    pickupContextSrc.indexOf("const completePickup ="),
    pickupContextSrc.indexOf("const acceptOverflowDispatch ="),
  );
  assert.doesNotMatch(completePickupBlock, /syncCompletedOverflowEvents/);
});

test("Scenario 3: Network interruption (Offline -> Online with 0 queued mutations reloads assignments & Realtime reconnect reloads)", () => {
  assert.match(offlineSyncSrc, /reconnected = wasConnected === false && isNowConnected/);
  assert.match(offlineSyncSrc, /if \(reconnected && typeof onReconnect === "function"\)/);
  assert.match(pickupContextSrc, /subscribeConnectivity\(\s*executeQueuedMutation,\s*reloadAfterConnectivity,\s*reloadAfterConnectivity/);
  assert.match(pickupContextSrc, /if \(status === "SUBSCRIBED"\)[\s\S]*if \(hadSubscribedOnce\)/);
  assert.match(notificationContextSrc, /NetInfo\.addEventListener/);
  assert.match(notificationContextSrc, /if \(status === "SUBSCRIBED"\)[\s\S]*if \(hadSubscribedOnce\)/);
});

test("Scenario 4: Incorrect driver isolation (Driver B sees assignment & notification; Driver C cannot see Driver B's assignment or notification)", () => {
  const driverB = { id: 202, authUserId: "auth-driver-b", vehicleId: 22 };
  const driverC = { id: 303, authUserId: "auth-driver-c", vehicleId: 33 };

  const eventForB = {
    id: "evt-isolated-b",
    status: "dispatched",
    source_driver_id: "101",
    source_driver_auth_user_id: "auth-driver-a",
    source_vehicle_id: "11",
    target_driver_id: "202",
    target_driver_auth_user_id: "auth-driver-b",
    target_vehicle_id: "22",
    overflow_bins: [{ bin_id: 1 }],
  };

  assert.equal(eventBelongsToDriverAsTarget(eventForB, driverB.id, driverB.vehicleId, driverB.authUserId), true);
  assert.equal(eventBelongsToDriverAsTarget(eventForB, driverC.id, driverC.vehicleId, driverC.authUserId), false);
  // Even if Driver C temporarily shared Truck 22, explicit target_driver_id / target_driver_auth_user_id locks out Driver C!
  assert.equal(eventBelongsToDriverAsTarget(eventForB, driverC.id, driverB.vehicleId, driverC.authUserId), false);

  // Notification visibility isolation: private driver notification has user_auth_id set & role NULL
  const notifForB = {
    id: 55,
    user_auth_id: "auth-driver-b",
    user_id: "auth-driver-b",
    role: null,
    title: "Overflow Assistance Assigned",
    read: false,
  };
  assert.equal(notificationVisibleToUser(notifForB, driverB.authUserId, "truck_driver"), true);
  assert.equal(notificationVisibleToUser(notifForB, driverC.authUserId, "truck_driver"), false);

  // Even if a legacy row had BOTH user_auth_id and role='truck_driver', Driver C must NOT see it
  const legacyAddressedNotif = { ...notifForB, role: "truck_driver" };
  assert.equal(notificationVisibleToUser(legacyAddressedNotif, driverB.authUserId, "truck_driver"), true);
  assert.equal(notificationVisibleToUser(legacyAddressedNotif, driverC.authUserId, "truck_driver"), false);
  assert.equal(notificationVisibleToUser({ ...legacyAddressedNotif }, driverC.authUserId, "truck_driver"), false);

  // Verify SQL RLS policies enforce the same strict isolation
  assert.match(migrationSql, /CREATE POLICY "users read addressed notifications"[\s\S]*user_auth_id IS NULL\s+AND user_id IS NULL\s+AND role = public\.current_app_role\(\)/i);
  assert.match(migrationSql, /CREATE POLICY "overflow_events_read_authenticated"[\s\S]*target_driver_auth_user_id = auth\.uid\(\)/i);
  assert.match(migrationSql, /v_event\.target_driver_auth_user_id <> auth\.uid\(\)/i);
  // Ensure Driver A cache cannot leak to Driver B on account switch
  assert.match(pickupContextSrc, /AsyncStorage\.removeItem\(PICKUPS_CACHE_KEY\)/);
});

test("Scenario 5: Duplicate prevention (idempotency locks and deduplicated notification inserts)", () => {
  assert.match(migrationSql, /pg_advisory_xact_lock\(hashtext\('overflow_source:'/i);
  assert.match(migrationSql, /IF v_event\.status = 'dispatched'[\s\S]*'idempotent', true/i);
  assert.match(migrationSql, /WHERE NOT EXISTS \([\s\S]*FROM public\.notifications n[\s\S]*n\.source_table = 'overflow_events'[\s\S]*n\.source_id =/i);
  assert.match(useOverflowDispatchSrc, /dispatchingEventIdsRef/);
  assert.match(useOverflowDispatchSrc, /signalingRouteIdsRef/);
  assert.match(useOverflowDispatchSrc, /dispatcher_notified !== true/);
  assert.match(pickupContextSrc, /rpcResult\?\.dispatcher_notified !== true/);
});

test("Scenario 6: Multiple dispatches (independent assignments route strictly to respective drivers; multi-pending queue preserves all)", () => {
  const driverB1 = { id: 202, authUserId: "auth-b1", vehicleId: 22 };
  const driverB2 = { id: 404, authUserId: "auth-b2", vehicleId: 44 };

  const ev1 = {
    id: "evt-multi-1",
    status: "dispatched",
    source_driver_id: "101",
    source_vehicle_id: "11",
    target_driver_id: "202",
    target_driver_auth_user_id: "auth-b1",
    target_vehicle_id: "22",
    dispatched_at: "2026-11-27T09:00:00Z",
    overflow_bins: [{ bin_id: 1 }],
  };
  const ev2 = {
    id: "evt-multi-2",
    status: "dispatched",
    source_driver_id: "102",
    source_vehicle_id: "12",
    target_driver_id: "404",
    target_driver_auth_user_id: "auth-b2",
    target_vehicle_id: "44",
    dispatched_at: "2026-11-27T09:05:00Z",
    overflow_bins: [{ bin_id: 2 }],
  };
  const ev3SameB1 = {
    id: "evt-multi-3",
    status: "dispatched",
    source_driver_id: "103",
    source_vehicle_id: "13",
    target_driver_id: "202",
    target_driver_auth_user_id: "auth-b1",
    target_vehicle_id: "22",
    dispatched_at: "2026-11-27T09:10:00Z",
    overflow_bins: [{ bin_id: 3 }],
  };

  const stateB1 = formatOverflowSyncState({
    driverId: driverB1.id,
    vehicleId: driverB1.vehicleId,
    authUserId: driverB1.authUserId,
    driverRoutes: [],
    overflowEvents: [ev1, ev2, ev3SameB1],
    allPickups: [],
  });
  const stateB2 = formatOverflowSyncState({
    driverId: driverB2.id,
    vehicleId: driverB2.vehicleId,
    authUserId: driverB2.authUserId,
    driverRoutes: [],
    overflowEvents: [ev1, ev2, ev3SameB1],
    allPickups: [],
  });

  assert.deepEqual(stateB1.pendingOverflowEvents.map((e) => e.id), ["evt-multi-3", "evt-multi-1"]);
  assert.equal(stateB1.incomingOverflowEvent?.id, "evt-multi-3");
  assert.deepEqual(stateB2.pendingOverflowEvents.map((e) => e.id), ["evt-multi-2"]);
  assert.equal(stateB2.incomingOverflowEvent?.id, "evt-multi-2");
});
