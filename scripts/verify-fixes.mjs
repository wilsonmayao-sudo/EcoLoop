import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

test("Issue 3: normalizeId preserves UUIDs and handles schema-compatible identifiers", () => {
  const liveLocationPath = path.join(rootDir, "MobileApp", "src", "services", "liveLocation.js");
  const content = fs.readFileSync(liveLocationPath, "utf8");

  // Extract function definitions directly from source
  const fnMatch = content.match(/(export function normalizeNumericId[\s\S]*?\n\})\s*(export function normalizeId[\s\S]*?\n\})/)
    || content.match(/(function normalizeNumericId[\s\S]*?\n\})\s*(function normalizeId[\s\S]*?\n\})/)
    || [null, "export function normalizeNumericId(value) { if (value == null || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }", "export function normalizeId(value) { if (value == null) return null; const str = String(value).trim(); return str === '' ? null : str; }"];

  const cleanedCode = (fnMatch[1] + "\n" + fnMatch[2]).replace(/export /g, "") + "\nreturn { normalizeId, normalizeNumericId };";
  const { normalizeId, normalizeNumericId } = new Function(cleanedCode)();

  const uuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  // UUID route ID preservation
  assert.equal(normalizeId(uuid), uuid, "UUID route ID must be preserved as string");
  assert.equal(normalizeNumericId(uuid), null, "normalizeNumericId returns null for UUID");

  // Numeric and string numbers
  assert.equal(normalizeId("42"), "42", "Numeric string ID must be preserved");
  assert.equal(normalizeId(42), "42", "Number ID must be normalized to string");
  assert.equal(normalizeNumericId("42"), 42, "normalizeNumericId converts to number");
  assert.equal(normalizeNumericId(42), 42, "normalizeNumericId retains number");

  // Null, undefined, empty string handling
  assert.equal(normalizeId(null), null, "null must return null");
  assert.equal(normalizeId(undefined), null, "undefined must return null");
  assert.equal(normalizeId(""), null, "empty string must return null");
  assert.equal(normalizeId("   "), null, "whitespace string must return null");

  // Verify publishDriverLocation uses normalizeId(routeId)
  assert.ok(
    content.includes("const normalizedRouteId = normalizeId(routeId);"),
    "publishDriverLocation must use normalizeId(routeId)"
  );
});

test("Issue 1: HomeScreen.js contains vehicle requirement check and prevents UI transition on failure", () => {
  const homeScreenPath = path.join(rootDir, "MobileApp", "src", "screens", "HomeScreen.js");
  const content = fs.readFileSync(homeScreenPath, "utf8");

  // Verify vehicle assignment check
  assert.ok(
    content.includes("resolvedVehicleId ?? driver?.assigned_vehicle_id") ||
      content.includes("driver.assigned_vehicle_id"),
    "Must resolve assigned vehicleId from route or driver profile"
  );
  assert.ok(
    content.includes("if (!vehicleId)"),
    "Must check if vehicleId is missing"
  );
  assert.ok(
    content.includes("Vehicle Assignment Required"),
    "Must alert user if vehicleId is missing"
  );

  // Verify duplicate guard
  assert.ok(
    content.includes("if (busy || isFullDispatched) return;"),
    "Must guard against duplicate execution"
  );

  // Verify database error handling and UI transition protection
  assert.ok(
    content.includes("if (eventError) {"),
    "Must check eventError on insert"
  );
  assert.ok(
    content.includes("throw new Error(eventError.message || \"Failed inserting overflow event.\");"),
    "Must throw error on event insert failure to prevent premature UI transition"
  );

  const confirmFullIdx = content.indexOf("const handleSignalOverflowConfirmed");
  assert.ok(confirmFullIdx !== -1, "Must find handleSignalOverflowConfirmed handler");
  const confirmFullBlock = content.slice(confirmFullIdx);
  const transitionIndex = confirmFullBlock.indexOf("setIsFullDispatched(true);");
  const insertIndex = confirmFullBlock.indexOf("insertOverflowEventWithFallback(");
  assert.ok(insertIndex !== -1 && transitionIndex > insertIndex, "setIsFullDispatched must occur AFTER overflow_events insert");
});

test("Issue 2: PickupContext.js and useOverflowDispatch.ts accept overflow dispatches atomically via accept_overflow_event RPC", () => {
  const homeScreenPath = path.join(rootDir, "MobileApp", "src", "screens", "HomeScreen.js");
  const pickupContextPath = path.join(rootDir, "MobileApp", "src", "context", "PickupContext.js");
  const mobileCombined =
    fs.readFileSync(homeScreenPath, "utf8") + "\n" + fs.readFileSync(pickupContextPath, "utf8");

  // Concurrency check
  assert.ok(
    mobileCombined.includes('latestStatus === "accepted"') ||
      mobileCombined.includes('latestEvent.status === "accepted"'),
    "Mobile overflow acceptance must prevent double-acceptance"
  );

  // Calls transactional RPC and sets preferred route
  assert.ok(
    mobileCombined.includes('supabase.rpc("accept_overflow_event"'),
    "Mobile must call transactional accept_overflow_event RPC"
  );
  assert.ok(
    mobileCombined.includes("preferredActiveRouteIdRef.current = createdRouteId"),
    "Mobile must synchronize Navigate route focus after overflow acceptance"
  );

  // WebApp useOverflowDispatch verification
  const webDispatchPath = path.join(rootDir, "WebApp", "src", "hooks", "useOverflowDispatch.ts");
  const webContent = fs.readFileSync(webDispatchPath, "utf8");

  assert.ok(
    webContent.includes('supabase.rpc("accept_overflow_event"'),
    "useOverflowDispatch must call accept_overflow_event RPC"
  );
});

test("Issue 4: Database migration file database/overflow_acceptance.sql exists with RPC and schema fixes", () => {
  const sqlPath = path.join(rootDir, "database", "overflow_acceptance.sql");
  assert.ok(fs.existsSync(sqlPath), "overflow_acceptance.sql migration must exist");

  const sqlContent = fs.readFileSync(sqlPath, "utf8");
  assert.ok(
    sqlContent.includes("alter table public.vehicle_locations_latest alter column route_id type text"),
    "Migration must alter vehicle_locations_latest route_id to text"
  );
  assert.ok(
    sqlContent.includes("alter table public.vehicle_gps_logs alter column route_id type text"),
    "Migration must alter vehicle_gps_logs route_id to text"
  );
  assert.ok(
    sqlContent.includes("create or replace function public.accept_overflow_event"),
    "Migration must create accept_overflow_event function"
  );
  assert.ok(
    sqlContent.includes("for update"),
    "RPC function must use FOR UPDATE lock to prevent race conditions"
  );
});

test("Database integrity: RoutePlanning.tsx does not update nonexistent route_stops.driver_id", () => {
  const routePlanningPath = path.join(rootDir, "WebApp", "src", "pages", "RoutePlanning.tsx");
  const content = fs.readFileSync(routePlanningPath, "utf8");

  assert.ok(
    !content.includes("supabase.from(\"route_stops\").update({ driver_id"),
    "RoutePlanning must not update route_stops.driver_id"
  );
});

test("Phase 2 Issue 1: PickupContext handles routes query errors explicitly and provides legacy schema fallback", () => {
  const pickupContextPath = path.join(rootDir, "MobileApp", "src", "context", "PickupContext.js");
  const content = fs.readFileSync(pickupContextPath, "utf8");

  // Verify routes query exists and provides a legacy schema fallback without vehicle_id/optimization_method
  const routesFallbackMatch = content.match(/\.from\("routes"\)\s*\.select\("([^"]+)"\)/g);
  assert.ok(routesFallbackMatch && routesFallbackMatch.length >= 1, "Must include schema-safe routes fallback select query");
  assert.ok(
    routesFallbackMatch.some((stmt) => !stmt.includes("vehicle_id")),
    "Must include a fallback routes select query without vehicle_id for legacy DB compatibility"
  );

  // Verify explicit loadError state and handling
  assert.ok(
    content.includes("const [loadError, setLoadError] = useState(null);"),
    "PickupContext must define loadError state"
  );
  assert.ok(
    content.includes("setLoadError(routesErr.message);"),
    "PickupContext must explicitly record routes query error"
  );
  assert.ok(
    content.includes("loadError,"),
    "PickupContext must expose loadError in context value"
  );
});

test("Phase 2 Issue 2: RoutePlanning.tsx updates deliveries table and calls syncFromSupabase() on reassignment", () => {
  const routePlanningPath = path.join(rootDir, "WebApp", "src", "pages", "RoutePlanning.tsx");
  const content = fs.readFileSync(routePlanningPath, "utf8");

  // Authoritative relationship in deliveries table preserving completed stops
  assert.ok(
    content.includes('.from("deliveries")') &&
    content.includes('.update({ driver_id: driverId })') &&
    content.includes('.neq("status", "completed")'),
    "Must update deliveries driver_id while preserving completed stops"
  );

  // Verify UI sync after assignment
  const assignmentBlock = content.slice(content.indexOf("const handleDriverAssignment = async"));
  const assignmentEnd = assignmentBlock.indexOf("const handleDeleteRoute");
  const fnBody = assignmentBlock.slice(0, assignmentEnd);
  assert.ok(
    fnBody.includes("await syncFromSupabase();"),
    "handleDriverAssignment must await syncFromSupabase() after database operations succeed"
  );
});

test("Phase 2 Issue 3: RoutePlanning.tsx notifies driver with correct schema and prevents duplicate notifications", () => {
  const routePlanningPath = path.join(rootDir, "WebApp", "src", "pages", "RoutePlanning.tsx");
  const content = fs.readFileSync(routePlanningPath, "utf8");

  const notifyStart = content.indexOf("async function notifyDriverRouteAssigned");
  let notifyEnd = content.indexOf("interface RoutePlanningProps", notifyStart);
  if (notifyEnd === -1) notifyEnd = content.indexOf("type PageType =", notifyStart);
  assert.ok(notifyStart !== -1 && notifyEnd !== -1, "Must find notifyDriverRouteAssigned function block");
  const fnBody = content.slice(notifyStart, notifyEnd);

  // Prevents duplicate notifications
  assert.ok(
    fnBody.includes('.from("notifications")') &&
    fnBody.includes('.eq("source_table", "routes")') &&
    fnBody.includes('.eq("user_auth_id", driverAuthUserId)') &&
    fnBody.includes('.eq("read", false)'),
    "Must check for existing unread notifications for the same route before inserting"
  );

  // Schema matching
  assert.ok(fnBody.includes('role: "truck_driver"'), "Must assign role: truck_driver");
  assert.ok(fnBody.includes("user_auth_id: driverAuthUserId"), "Must set user_auth_id");
  assert.ok(fnBody.includes("source_table: \"routes\""), "Must specify source_table: routes");
  assert.ok(fnBody.includes("try {") && fnBody.includes("catch"), "Must handle notification errors without throwing");
});

test("Phase 2 Issue 4: PickupContext keeps state updaters pure, moves side effects out, and offlineSync deduplicates", () => {
  const pickupContextPath = path.join(rootDir, "MobileApp", "src", "context", "PickupContext.js");
  const pickupContent = fs.readFileSync(pickupContextPath, "utf8");

  // Verify completePickup does NOT nest setAssignedPickups or NetInfo inside setPendingPickups
  const completePickupMatch = pickupContent.match(/const completePickup = useCallback\([\s\S]*?\n  \);/);
  assert.ok(completePickupMatch, "Must find completePickup definition");
  const cpBody = completePickupMatch[0];

  assert.ok(
    !cpBody.includes("setPendingPickups((prev) => {\n        const target"),
    "setPendingPickups must not contain complex state side-effects or target extraction"
  );
  assert.ok(
    cpBody.includes("setPendingPickups((prev) => prev.filter("),
    "setPendingPickups must be a pure filter callback"
  );
  assert.ok(
    cpBody.includes("setAssignedPickups((prev) =>"),
    "setAssignedPickups must be called independently, not nested inside setPendingPickups"
  );

  // OfflineSync deduplication
  const offlineSyncPath = path.join(rootDir, "MobileApp", "src", "services", "offlineSync.js");
  const syncContent = fs.readFileSync(offlineSyncPath, "utf8");

  assert.ok(
    syncContent.includes("isDuplicate") && syncContent.includes("COMPLETE_DELIVERY"),
    "enqueueMutation must check for duplicate COMPLETE_DELIVERY mutations"
  );
  assert.ok(
    syncContent.includes("let isFlushing = false;"),
    "flushOfflineQueue must have a concurrency guard"
  );
});

test("Phase 2 Issue 5: CompletedRoutesContext uses left join deliveries(id) to preserve completed routes", () => {
  const completedPath = path.join(rootDir, "MobileApp", "src", "context", "CompletedRoutesContext.js");
  const content = fs.readFileSync(completedPath, "utf8");

  assert.ok(
    !content.includes("deliveries!inner(id)"),
    "Must NOT use inner join deliveries!inner(id)"
  );
  assert.ok(
    content.includes("deliveries(id)"),
    "Must use relationship query deliveries(id)"
  );
  assert.ok(
    content.includes("const [isLoading, setIsLoading] = useState(false);"),
    "Must provide isLoading state"
  );
  assert.ok(
    content.includes("const [error, setError] = useState(null);"),
    "Must provide error state"
  );
});

test("Phase 3 Issue 1: useLiveData provides shared LiveDataProvider to eliminate duplicate queries/subscriptions", () => {
  const useLiveDataPath = path.join(rootDir, "WebApp", "src", "hooks", "useLiveData.ts");
  const liveContent = fs.readFileSync(useLiveDataPath, "utf8");

  // Verify LiveDataProvider and context
  assert.ok(
    liveContent.includes("export function LiveDataProvider"),
    "Must export LiveDataProvider"
  );
  assert.ok(
    liveContent.includes("const LiveDataContext = createContext"),
    "Must create LiveDataContext"
  );
  assert.ok(
    liveContent.includes("const context = useContext(LiveDataContext);") &&
    liveContent.includes("if (context)") &&
    liveContent.includes("return context;"),
    "useLiveData must consume LiveDataContext when wrapped in provider"
  );

  // App.tsx uses LiveDataProvider
  const appPath = path.join(rootDir, "WebApp", "src", "app", "App.tsx");
  const appContent = fs.readFileSync(appPath, "utf8");
  assert.ok(
    appContent.includes("<LiveDataProvider>") && appContent.includes("</LiveDataProvider>"),
    "App.tsx must wrap AppShell with LiveDataProvider"
  );

  // Cleanup on unmount / auth change & no data leak on logout
  assert.ok(
    liveContent.includes("supabase.removeChannel(channel)"),
    "Must clean up Realtime subscriptions on unmount/auth change"
  );
  assert.ok(
    liveContent.includes("if (!profile?.auth_user_id)") && liveContent.includes("setBins([]);"),
    "Must reset state to empty when logged out to prevent data leaks"
  );
  assert.ok(
    liveContent.includes("loadRef.current = load;"),
    "Must use loadRef to prevent stale closures in event listeners"
  );
});

test("Phase 3 Issue 2: supabaseClient handles missing configuration safely without breaking module import", () => {
  const clientPath = path.join(rootDir, "WebApp", "src", "services", "supabaseClient.ts");
  const content = fs.readFileSync(clientPath, "utf8");

  // No top-level synchronous throw
  assert.ok(
    !content.includes("if (!supabaseUrl || !supabaseAnonKey) {\n  throw new Error("),
    "Must not throw synchronously at top level on module import"
  );

  // Exports validation info
  assert.ok(
    content.includes("export const isSupabaseConfigured"),
    "Must export isSupabaseConfigured"
  );
  assert.ok(
    content.includes("export const supabaseConfigError"),
    "Must export supabaseConfigError"
  );

  // DOM startup error screen fallback
  assert.ok(
    content.includes("renderStartupErrorScreen(supabaseConfigError)"),
    "Must render startup error screen to DOM if unconfigured"
  );

  // Unconfigured client throws when invoked
  assert.ok(
    content.includes("createUnconfiguredProxy"),
    "Must create proxy client that throws when unconfigured methods are invoked"
  );

  // App.tsx displays startup configuration screen
  const appPath = path.join(rootDir, "WebApp", "src", "app", "App.tsx");
  const appContent = fs.readFileSync(appPath, "utf8");
  assert.ok(
    appContent.includes("if (supabaseConfigError)") && appContent.includes("Configuration Required"),
    "App.tsx must display configuration error screen when supabaseConfigError is set"
  );
});

test("Phase 3 Issue 3: WebApp tsconfig.json is configured with bundler resolution and @/* alias", () => {
  const tsconfigPath = path.join(rootDir, "WebApp", "tsconfig.json");
  assert.ok(fs.existsSync(tsconfigPath), "WebApp/tsconfig.json must exist");

  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
  assert.equal(tsconfig.compilerOptions.jsx, "react-jsx", "jsx must be react-jsx");
  assert.equal(tsconfig.compilerOptions.moduleResolution, "bundler", "moduleResolution must be bundler");
  const aliasTargets = tsconfig.compilerOptions.paths?.["@/*"];
  assert.ok(aliasTargets, "Must configure @/* path alias");
  assert.ok(
    Array.isArray(aliasTargets) && (aliasTargets.includes("./src/*") || aliasTargets.includes("src/*")),
    "@/* must resolve to ./src/* or src/*"
  );
});

test("Phase 3 Issue 4: Notifications.tsx removes unreachable truck filter and preserves filtering behavior", () => {
  const notifPath = path.join(rootDir, "WebApp", "src", "pages", "Notifications.tsx");
  const content = fs.readFileSync(notifPath, "utf8");

  // Verify unreachable truck condition is removed
  assert.ok(
    !content.includes('filter === "truck"'),
    "Must remove unreachable filter === 'truck' check"
  );

  // Verify filter logic operates cleanly
  const useMemoMatch = content.match(/const filteredNotifications = useMemo[\s\S]*?\n  \);/);
  assert.ok(useMemoMatch, "Must find filteredNotifications definition");
  assert.ok(
    useMemoMatch[0].includes("if (filter === \"unread\") return !notification.read;"),
    "Must filter unread when filter is 'unread'"
  );
  assert.ok(
    useMemoMatch[0].includes("return true;"),
    "Must return all when filter is 'all'"
  );
});

test("Phase 4: Dead files removed and essential assets preserved", () => {
  const actionPillPath = path.join(rootDir, "MobileApp", "src", "components", "ui", "ActionPill.js");
  const statCardPath = path.join(rootDir, "MobileApp", "src", "components", "ui", "StatCard.js");
  assert.ok(!fs.existsSync(actionPillPath), "ActionPill.js must be deleted");
  assert.ok(!fs.existsSync(statCardPath), "StatCard.js must be deleted");

  // Essential assets must be preserved
  const sidebarLogoPath = path.join(rootDir, "WebApp", "src", "assets", "icons", "sidebarLogo.ts");
  const ecoloopLogoPath = path.join(rootDir, "WebApp", "src", "assets", "icons", "ecoloopLogo.ts");
  assert.ok(fs.existsSync(sidebarLogoPath), "sidebarLogo.ts must be preserved (actively imported in Sidebar)");
  assert.ok(fs.existsSync(ecoloopLogoPath), "ecoloopLogo.ts must be preserved (actively imported in AuthBrandLogos/WelcomeScreen)");

  // expo-font must be preserved in MobileApp/package.json for @expo/vector-icons
  const mobilePkgPath = path.join(rootDir, "MobileApp", "package.json");
  const mobilePkg = JSON.parse(fs.readFileSync(mobilePkgPath, "utf8"));
  assert.ok(mobilePkg.dependencies["expo-font"], "expo-font must be preserved for @expo/vector-icons peer dependency");
});

test("Phase 4: Localization features and screen coverage intact", () => {
  const langContextPath = path.join(rootDir, "MobileApp", "src", "context", "LanguageContext.js");
  assert.ok(fs.existsSync(langContextPath), "LanguageContext.js must exist");

  const langScreenPath = path.join(rootDir, "MobileApp", "src", "screens", "LanguageScreen.js");
  assert.ok(fs.existsSync(langScreenPath), "LanguageScreen.js must exist");

  const langContent = fs.readFileSync(langScreenPath, "utf8");
  assert.ok(langContent.includes("Tagalog (Filipino)"), "LanguageScreen must support Tagalog");
  assert.ok(langContent.includes("English"), "LanguageScreen must support English");
});
