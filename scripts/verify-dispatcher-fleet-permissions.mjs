import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const esbuild = require(path.resolve("WebApp/node_modules/esbuild"));

const root = process.cwd();
const tmpDir = path.resolve(root, "WebApp/.tmp-verify-fleet-rbac");
fs.mkdirSync(tmpDir, { recursive: true });

try {
  const outFile = path.join(tmpDir, "fleetPermissions.mjs");
  const built = esbuild.buildSync({
    entryPoints: [path.resolve(root, "WebApp/src/utils/fleetPermissions.ts")],
    bundle: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile: outFile,
    write: true,
  });
  assert.equal(built.errors.length, 0, "esbuild compile must succeed cleanly");

  const { getFleetRegistryPermissions } = await import(pathToFileURL(outFile).href);

  // 1. Admin retains full Fleet Registry control; Dispatcher is restricted strictly to viewing & driver assignment (+ overflow dispatch)
  assert.deepEqual(getFleetRegistryPermissions("admin"), {
    canViewFleet: true,
    canManageFleet: true,
    canAddTruck: true,
    canEditTruck: true,
    canUpdateTruckStatus: true,
    canAssignDriver: true,
    canDeleteTruck: true,
    canManageMaintenance: true,
    canDispatchOverflow: true,
  });

  const dispatcherExpected = {
    canViewFleet: true,
    canManageFleet: false,
    canAddTruck: false,
    canEditTruck: false,
    canUpdateTruckStatus: false,
    canAssignDriver: true,
    canDeleteTruck: false,
    canManageMaintenance: false,
    canDispatchOverflow: true,
  };
  assert.deepEqual(getFleetRegistryPermissions("dispatcher"), dispatcherExpected);
  assert.deepEqual(getFleetRegistryPermissions("  DISPATCHER "), dispatcherExpected);

  // 2. Supervisor remains strictly read-only; driver/unknown denied
  assert.deepEqual(getFleetRegistryPermissions("supervisor"), {
    canViewFleet: true,
    canManageFleet: false,
    canAddTruck: false,
    canEditTruck: false,
    canUpdateTruckStatus: false,
    canAssignDriver: false,
    canDeleteTruck: false,
    canManageMaintenance: false,
    canDispatchOverflow: false,
  });
  assert.deepEqual(getFleetRegistryPermissions("truck_driver"), {
    canViewFleet: false,
    canManageFleet: false,
    canAddTruck: false,
    canEditTruck: false,
    canUpdateTruckStatus: false,
    canAssignDriver: false,
    canDeleteTruck: false,
    canManageMaintenance: false,
    canDispatchOverflow: false,
  });
  assert.deepEqual(getFleetRegistryPermissions(null), {
    canViewFleet: false,
    canManageFleet: false,
    canAddTruck: false,
    canEditTruck: false,
    canUpdateTruckStatus: false,
    canAssignDriver: false,
    canDeleteTruck: false,
    canManageMaintenance: false,
    canDispatchOverflow: false,
  });

  // 3. Frontend UI & Admin-only module boundaries
  const appSrc = fs.readFileSync(path.resolve(root, "WebApp/src/app/App.tsx"), "utf8");
  assert.match(appSrc, /set\.delete\("users"\)/);
  assert.match(appSrc, /set\.delete\("system-settings"\)/);

  const liveMonSrc = fs.readFileSync(path.resolve(root, "WebApp/src/pages/LiveMonitoring.tsx"), "utf8");
  assert.match(liveMonSrc, /getFleetRegistryPermissions\(effectiveRole\)/);
  assert.match(liveMonSrc, /const canAssignDrivers = fleetPermissions\.canAssignDriver;/);
  assert.match(liveMonSrc, /const canManageOverflow = fleetPermissions\.canDispatchOverflow;/);
  assert.match(liveMonSrc, /<FleetMaintenancePanel canManage=\{canManageFleet\} canAssignDrivers=\{canAssignDrivers\} \/>/);

  const fleetPanelSrc = fs.readFileSync(
    path.resolve(root, "WebApp/src/components/fleet/FleetMaintenancePanel.tsx"),
    "utf8",
  );
  // Driver assignment handlers/UI check canAssignDrivers; truck/maintenance CRUD handlers/UI check canManage
  assert.match(fleetPanelSrc, /handleInlineDriverAssign[\s\S]*?if \(!canAssignDrivers\) return;/);
  assert.match(fleetPanelSrc, /handleDriverVehicleAssign[\s\S]*?if \(!canAssignDrivers\) return;/);
  assert.match(fleetPanelSrc, /openAddVehicle[\s\S]*?if \(!canManage\) return;/);
  assert.match(fleetPanelSrc, /openEditVehicle[\s\S]*?if \(!canManage\) return;/);
  assert.match(fleetPanelSrc, /openScheduleMaintenance[\s\S]*?if \(!canManage\) return;/);
  assert.match(fleetPanelSrc, /handleSaveVehicle[\s\S]*?if \(!canManage\) return;/);
  assert.match(fleetPanelSrc, /handleConfirmDeleteVehicle[\s\S]*?if \(!vehicleToDelete \|\| !canManage\) return;/);
  assert.match(fleetPanelSrc, /handleConfirmToggleVehicleActive[\s\S]*?if \(!vehicleToToggle \|\| !canManage\) return;/);
  assert.match(fleetPanelSrc, /handleSaveMaintenance[\s\S]*?if \(!canManage\) return;/);
  assert.match(fleetPanelSrc, /handleMaintenanceTransition[\s\S]*?if \(!canManage\) return;/);
  assert.match(fleetPanelSrc, /\{canManage && showVehicleModal/);
  assert.match(fleetPanelSrc, /\{canManage && showMaintModal/);

  // 4. Service/hook-layer authorization checks in useLiveData.ts
  const liveDataSrc = fs.readFileSync(path.resolve(root, "WebApp/src/hooks/useLiveData.ts"), "utf8");
  assert.match(liveDataSrc, /createVehicle[\s\S]*?assertAdminFleetControl\(\)/);
  assert.match(liveDataSrc, /updateVehicle[\s\S]*?assertAdminFleetControl\(\)/);
  assert.match(liveDataSrc, /deleteVehicle[\s\S]*?assertAdminFleetControl\(\)/);
  assert.match(liveDataSrc, /createMaintenanceRecord[\s\S]*?assertAdminFleetControl\(\)/);
  assert.match(liveDataSrc, /updateMaintenanceRecord[\s\S]*?assertAdminFleetControl\(\)/);
  assert.match(liveDataSrc, /assignVehicleDriver[\s\S]*?assertDriverAssignmentControl\(\)/);
  assert.match(liveDataSrc, /supabase\.rpc\("assign_vehicle_driver"/);

  // 5. Backend PostgreSQL RLS, column-level triggers, and RPC checks
  const migrationSrc = fs.readFileSync(
    path.resolve(root, "supabase/migrations/20261127010000_fix_dispatcher_fleet_registry_permissions.sql"),
    "utf8",
  );
  assert.match(migrationSrc, /DROP POLICY IF EXISTS "dispatchers manage vehicles" ON public\.vehicles;/);
  assert.match(migrationSrc, /DROP POLICY IF EXISTS "vehicles_admin_dispatcher_manage" ON public\.vehicles;/);
  assert.match(migrationSrc, /DROP POLICY IF EXISTS "dispatchers manage maintenance" ON public\.maintenance_records;/);
  assert.match(migrationSrc, /CREATE POLICY "vehicles_admin_manage" ON public\.vehicles[\s\S]*?FOR ALL[\s\S]*?public\.is_admin\(auth\.uid\(\)\)/);
  assert.match(migrationSrc, /CREATE POLICY "vehicles_dispatcher_assign_driver" ON public\.vehicles[\s\S]*?FOR UPDATE[\s\S]*?public\.is_dispatcher\(auth\.uid\(\)\)/);
  assert.match(migrationSrc, /CREATE POLICY "admins manage maintenance" ON public\.maintenance_records[\s\S]*?FOR ALL[\s\S]*?public\.is_admin\(auth\.uid\(\)\)/);
  assert.match(migrationSrc, /CREATE POLICY "drivers_admin_manage" ON public\.drivers[\s\S]*?FOR ALL[\s\S]*?public\.is_admin\(auth\.uid\(\)\)/);
  assert.match(migrationSrc, /CREATE POLICY "drivers_dispatcher_assign_vehicle" ON public\.drivers[\s\S]*?FOR UPDATE[\s\S]*?public\.is_dispatcher\(auth\.uid\(\)\)/);
  assert.match(migrationSrc, /CREATE OR REPLACE FUNCTION public\.enforce_dispatcher_vehicle_update_scope\(\)[\s\S]*?SECURITY INVOKER/);
  assert.match(migrationSrc, /CREATE OR REPLACE FUNCTION public\.enforce_dispatcher_driver_update_scope\(\)[\s\S]*?SECURITY INVOKER/);
  assert.match(migrationSrc, /CREATE OR REPLACE FUNCTION public\.assign_vehicle_driver\(/);
  assert.match(migrationSrc, /\('admin', 'live-monitoring', true, true, true, true\)/);
  assert.match(migrationSrc, /\('dispatcher', 'live-monitoring', true, false, true, false\)/);
  assert.doesNotMatch(migrationSrc, /ON public\.user_profiles/i);
  assert.doesNotMatch(migrationSrc, /ON public\.system_settings/i);

  const seedSrc = fs.readFileSync(path.resolve(root, "database/seed.sql"), "utf8");
  assert.match(seedSrc, /\('admin', 'live-monitoring', true, true, true, true\)/);
  assert.match(seedSrc, /\('dispatcher', 'live-monitoring', true, false, true, false\)/);

  console.log("ALL 5 RESTRICTED DISPATCHER FLEET PERMISSION CHECKS PASSED");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
