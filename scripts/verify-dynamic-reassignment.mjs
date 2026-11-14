import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

async function loadBundledModule(entryPath) {
  const esbuildUrl = pathToFileURL(
    path.join(rootDir, "WebApp", "node_modules", "esbuild", "lib", "main.js"),
  ).href;
  const esbuild = (await import(esbuildUrl)).default;
  const buildResult = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
  });
  const code = buildResult.outputFiles[0].text;
  const moduleExports = {};
  const moduleFn = new Function("exports", "require", "module", "__filename", "__dirname", code);
  const fakeModule = { exports: moduleExports };
  moduleFn(moduleExports, () => ({}), fakeModule, entryPath, path.dirname(entryPath));
  return fakeModule.exports;
}

const webAlgoPath = path.join(rootDir, "WebApp", "src", "utils", "routing", "dynamicReassignment.ts");
const mobileAlgoPath = path.join(rootDir, "MobileApp", "src", "utils", "dynamicReassignment.js");

test("Scenario 1: Truck FULL overflow UI & uncollected-stop dispatch wiring exist in MobileApp & WebApp", () => {
  const homeScreenPath = path.join(rootDir, "MobileApp", "src", "screens", "HomeScreen.js");
  const content = fs.readFileSync(homeScreenPath, "utf8");

  assert.ok(content.includes("driverLoadPercent"), "HomeScreen must track driverLoadPercent");
  assert.ok(content.includes("handleUpdateCapacity"), "HomeScreen must provide handleUpdateCapacity handler");
  assert.ok(content.includes("Truck Load Level (Driver-Reported)"), "HomeScreen must render truck load selector");
  assert.ok(
    content.includes("REPORT FULL (EMERGENCY REASSIGNMENT)") || content.includes("TRUCK FULL"),
    "HomeScreen must provide report full action button",
  );
  assert.ok(content.includes("SWMO_LANDFILL"), "HomeScreen must route full truck to SWMO Sanitary Landfill");
  assert.ok(content.includes("load_percent: 100"), "HomeScreen must update load_percent to 100 on full dispatch");
  assert.ok(
    content.includes("evaluateMultiCriteriaReassignment"),
    "HomeScreen must invoke shared evaluateMultiCriteriaReassignment engine",
  );
  assert.ok(
    !content.includes("capScore * 0.55 + distScore * 0.45"),
    "HomeScreen must not contain legacy inline capScore/distScore heuristic",
  );
});

test("Scenario 2: Single eligible truck has enough capacity and minimizes route detour", async () => {
  const {
    runAlgorithmBenchmark,
    BENCHMARK_SCENARIOS,
  } = await loadBundledModule(webAlgoPath);

  const sc1 = BENCHMARK_SCENARIOS[0];
  const benchmarkResult = runAlgorithmBenchmark(sc1);

  assert.equal(benchmarkResult.baseline.selectedVehicleId, "veh-3");
  assert.equal(benchmarkResult.proposed.selectedVehicleId, "veh-4");
  assert.equal(benchmarkResult.proposed.selectedVehiclesCount, 1);
  assert.equal(benchmarkResult.proposed.capacityViolations, 0);
  assert.equal(benchmarkResult.proposed.unservedStops, 0);
  assert.ok(
    benchmarkResult.proposed.additionalDistanceKm < benchmarkResult.baseline.additionalDistanceKm,
    "Proposed detour ΔD must be lower than Baseline nearest-truck detour",
  );
});

test("Scenario 3: Multiple trucks are required to split stops when no single truck fits all uncollected stops", async () => {
  const {
    BENCHMARK_SCENARIOS,
    evaluateMultiCriteriaReassignment,
  } = await loadBundledModule(webAlgoPath);

  const sc4 = BENCHMARK_SCENARIOS[3];
  assert.ok(sc4, "BENCHMARK_SCENARIOS[3] (Multi-Truck Split) must exist");

  const splitResult = evaluateMultiCriteriaReassignment(
    sc4.candidates,
    sc4.uncollectedStops,
    sc4.disposalSite,
  );

  assert.equal(splitResult.isMultiTruck, true, "Multi-truck split must activate when single truck cannot hold all stops");
  assert.ok(splitResult.assignments.length >= 2, "Must produce >= 2 truck assignments");
  assert.equal(splitResult.unassignedStops.length, 0, "All 6 stops must be covered by combined fleet headroom");
  for (const a of splitResult.assignments) {
    assert.ok(a.projectedLoadPercent <= 100, `Assigned truck ${a.label} must not exceed 100% capacity`);
    assert.ok(a.stopsCount >= 1);
  }

  // Verify partial unassigned remainder when total stops exceed combined fleet capacity
  const overloadedStops = Array.from({ length: 12 }, (_, idx) => ({
    id: `ov-${idx + 1}`,
    binId: 900 + idx,
    coordinate: { lat: 13.621 + idx * 0.001, lng: 123.195 + idx * 0.001 },
    stopOrder: idx + 1,
    location: `Heavy Stop #${idx + 1}`,
    estimatedVolumeLiters: 800,
    estimatedWeightKg: 400,
  }));
  const tightCandidates = [
    {
      id: "tight-1",
      label: "Truck Tight 1",
      driverId: "d1",
      driverName: "Driver 1",
      driverStatus: "available",
      isActive: true,
      currentLocation: { lat: 13.620, lng: 123.194 },
      currentLoadPercent: 75,
      loadSource: "driver_reported",
      status: "available",
      capacityLiters: 4000,
      capacityKg: 2000,
      isGpsFresh: true,
    },
    {
      id: "tight-2",
      label: "Truck Tight 2",
      driverId: "d2",
      driverName: "Driver 2",
      driverStatus: "available",
      isActive: true,
      currentLocation: { lat: 13.625, lng: 123.199 },
      currentLoadPercent: 80,
      loadSource: "driver_reported",
      status: "available",
      capacityLiters: 4000,
      capacityKg: 2000,
      isGpsFresh: true,
    },
  ];
  const overflowRemainder = evaluateMultiCriteriaReassignment(tightCandidates, overloadedStops);
  assert.ok(
    overflowRemainder.unassignedStops.length > 0,
    "Excess stops must remain unassigned instead of violating truck capacity limits",
  );
  for (const a of overflowRemainder.assignments) {
    assert.ok(a.projectedLoadPercent <= 100, "No assignment may violate 100% truck capacity limit");
  }
});

test("Scenario 4: Nearly-full nearest truck is skipped & capacity_liters vs capacity_kg remain distinct", async () => {
  const {
    BENCHMARK_SCENARIOS,
    evaluateMultiCriteriaReassignment,
    estimateStopDemand,
  } = await loadBundledModule(webAlgoPath);

  const sc2 = BENCHMARK_SCENARIOS[1];
  const res2 = evaluateMultiCriteriaReassignment(sc2.candidates, sc2.uncollectedStops, sc2.disposalSite);
  const veh2Eval = res2.evaluations.find((e) => e.vehicleId === "veh-2");

  assert.equal(res2.selectedCandidate?.vehicleId, "veh-4", "Must skip nearly-full nearest truck veh-2");
  assert.equal(veh2Eval?.eligible, false, "veh-2 (95% full) must be marked ineligible");

  const weightLimitedEst = estimateStopDemand(
    {
      id: "w1",
      binId: 1,
      coordinate: { lat: 13.62, lng: 123.19 },
      stopOrder: 1,
      location: "Weight Heavy Bin",
      estimatedVolumeLiters: 200, // 200 / 4000 = 5%
      estimatedWeightKg: 500,     // 500 / 1000 = 50% (binding!)
    },
    { capacityLiters: 4000, capacityKg: 1000 },
  );
  assert.equal(weightLimitedEst.limitingFactor, "weight");
  assert.equal(weightLimitedEst.percentOfTruck, 50);

  const volumeLimitedEst = estimateStopDemand(
    {
      id: "v1",
      binId: 2,
      coordinate: { lat: 13.62, lng: 123.19 },
      stopOrder: 1,
      location: "Bulky Bin",
      estimatedVolumeLiters: 1000, // 1000 / 2000 = 50% (binding!)
      estimatedWeightKg: 100,      // 100 / 2000 = 5%
    },
    { capacityLiters: 2000, capacityKg: 2000 },
  );
  assert.equal(volumeLimitedEst.limitingFactor, "volume");
  assert.equal(volumeLimitedEst.percentOfTruck, 50);
});

test("Scenario 5: Offline / stale-GPS trucks are excluded with zero hardcoded coordinate fallback", async () => {
  const { evaluateCandidateEligibility, evaluateMultiCriteriaReassignment } = await loadBundledModule(webAlgoPath);

  const staleByFlag = evaluateCandidateEligibility({
    id: "gps-1",
    label: "Stale Flag",
    driverId: "d1",
    driverName: "D1",
    driverStatus: "available",
    currentLocation: { lat: 13.622, lng: 123.195 },
    currentLoadPercent: 20,
    loadSource: "driver_reported",
    status: "available",
    isGpsFresh: false,
  });
  assert.equal(staleByFlag.eligible, false);

  const staleByAge = evaluateCandidateEligibility({
    id: "gps-2",
    label: "Stale Age",
    driverId: "d2",
    driverName: "D2",
    driverStatus: "available",
    currentLocation: { lat: 13.622, lng: 123.195 },
    currentLoadPercent: 20,
    loadSource: "driver_reported",
    status: "available",
    gpsAgeSeconds: 185,
    maxOfflineSeconds: 90,
  });
  assert.equal(staleByAge.eligible, false);

  const missingGps = evaluateCandidateEligibility({
    id: "gps-3",
    label: "Null GPS",
    driverId: "d3",
    driverName: "D3",
    driverStatus: "available",
    currentLocation: null,
    currentLoadPercent: 20,
    loadSource: "driver_reported",
    status: "available",
  });
  assert.equal(missingGps.eligible, false);

  const zeroIsland = evaluateCandidateEligibility({
    id: "gps-4",
    label: "Zero Coords",
    driverId: "d4",
    driverName: "D4",
    driverStatus: "available",
    currentLocation: { lat: 0, lng: 0 },
    currentLoadPercent: 20,
    loadSource: "driver_reported",
    status: "available",
    isGpsFresh: true,
  });
  assert.equal(zeroIsland.eligible, false);

  const hookSource = fs.readFileSync(path.join(rootDir, "WebApp", "src", "hooks", "useOverflowDispatch.ts"), "utf8");
  const mobileSource = fs.readFileSync(path.join(rootDir, "MobileApp", "src", "screens", "HomeScreen.js"), "utf8");
  assert.ok(!hookSource.includes("13.6218"), "useOverflowDispatch must not use hardcoded 13.6218 coordinate fallback");
  assert.ok(!mobileSource.includes("13.6218"), "Mobile HomeScreen must not use hardcoded 13.6218 coordinate fallback");

  const noneResult = evaluateMultiCriteriaReassignment(
    [
      {
        id: "gps-offline",
        label: "Offline Truck",
        driverId: "d9",
        driverName: "Offline",
        driverStatus: "offline",
        currentLocation: { lat: 13.622, lng: 123.195 },
        currentLoadPercent: 10,
        loadSource: "driver_reported",
        status: "available",
        isGpsFresh: false,
      },
    ],
    [{ id: "s1", binId: 1, coordinate: { lat: 13.623, lng: 123.196 }, stopOrder: 1, location: "Stop 1" }],
  );
  assert.equal(noneResult.assignments.length, 0);
  assert.equal(noneResult.unassignedStops.length, 1);
});

test("Scenario 6: Trucks without valid driver, inactive/unavailable status, unverified load, or active overflow lock are excluded", async () => {
  const { evaluateCandidateEligibility } = await loadBundledModule(webAlgoPath);

  const base = {
    id: "veh-test",
    label: "Truck Test",
    driverId: "101",
    driverName: "Test Driver",
    driverStatus: "available",
    isActive: true,
    currentLocation: { lat: 13.622, lng: 123.195 },
    currentLoadPercent: 20,
    loadSource: "driver_reported",
    status: "available",
    isGpsFresh: true,
    hasActiveOverflowAssignment: false,
  };

  assert.equal(evaluateCandidateEligibility({ ...base, driverId: null }).eligible, false);
  assert.equal(evaluateCandidateEligibility({ ...base, driverStatus: "suspended" }).eligible, false);
  assert.equal(evaluateCandidateEligibility({ ...base, driverStatus: "offline" }).eligible, false);
  assert.equal(evaluateCandidateEligibility({ ...base, isActive: false }).eligible, false);
  assert.equal(evaluateCandidateEligibility({ ...base, status: "maintenance" }).eligible, false);
  assert.equal(evaluateCandidateEligibility({ ...base, status: "assisting_overflow" }).eligible, false);
  assert.equal(evaluateCandidateEligibility({ ...base, status: "unloading" }).eligible, false);
  assert.equal(evaluateCandidateEligibility({ ...base, hasActiveOverflowAssignment: true }).eligible, false);
  assert.equal(evaluateCandidateEligibility({ ...base, loadSource: "unverified", currentLoadPercent: null }).eligible, false);
  assert.equal(evaluateCandidateEligibility(base).eligible, true);
});

test("Scenario 7: Route recalculation uses Mapbox Directions and includes landfill destination", () => {
  const hookContent = fs.readFileSync(
    path.join(rootDir, "WebApp", "src", "hooks", "useOverflowDispatch.ts"),
    "utf8",
  );
  const liveMonContent = fs.readFileSync(
    path.join(rootDir, "WebApp", "src", "pages", "LiveMonitoring.tsx"),
    "utf8",
  );

  assert.ok(hookContent.includes("fetchStreetRouteWithFeedback"), "Hook must calculate street routes via Mapbox Directions service");
  assert.ok(hookContent.includes("getConfiguredLandfill"), "Hook must resolve configured SWMO landfill destination");
  assert.ok(hookContent.includes("syncAssistingRouteWithMapbox"), "Hook must sync assisting route distances/durations with Mapbox");

  assert.ok(liveMonContent.includes("fetchStreetRouteGeometry"), "LiveMonitoring must compute Mapbox road-following routes");
  assert.ok(liveMonContent.includes("liveMapRoutes"), "LiveMonitoring must pass road-following liveMapRoutes to LiveFleetMap");
  assert.ok(liveMonContent.includes("Auto-Assign Optimal"), "LiveMonitoring must expose Auto-Assign Optimal dispatch control");
  assert.ok(liveMonContent.includes("overflow-bin:"), "LiveMonitoring must render overflow stop markers on the map");
});

test("Scenario 8: Concurrent / duplicate overflow acceptance & stop conflict protections exist across hook & SQL", () => {
  const hookContent = fs.readFileSync(
    path.join(rootDir, "WebApp", "src", "hooks", "useOverflowDispatch.ts"),
    "utf8",
  );
  assert.ok(hookContent.includes("acceptingEventIdsRef"), "Hook must guard against concurrent double-acceptance");

  const sqlFiles = [
    path.join(rootDir, "supabase", "migrations", "20261114213000_dynamic_overflow_reassignment.sql"),
    path.join(rootDir, "supabase", "schemas", "public", "functions", "accept_overflow_event.sql"),
    path.join(rootDir, "database", "overflow_acceptance.sql"),
  ];

  for (const sqlFile of sqlFiles) {
    assert.ok(fs.existsSync(sqlFile), `${sqlFile} must exist`);
    const sql = fs.readFileSync(sqlFile, "utf8");
    const lower = sql.toLowerCase();
    assert.ok(lower.includes("for update"), `${path.basename(sqlFile)} must lock overflow row FOR UPDATE`);
    assert.ok(lower.includes("source_driver_id"), `${path.basename(sqlFile)} must reject self-assignment`);
    assert.ok(lower.includes("assisting_vehicle_id"), `${path.basename(sqlFile)} must record assisting_vehicle_id audit metadata`);
    assert.ok(lower.includes("original_driver_id"), `${path.basename(sqlFile)} must preserve original_driver_id`);
    assert.ok(lower.includes("assistance_reason"), `${path.basename(sqlFile)} must record assistance_reason`);
    assert.ok(lower.includes("reassigned_at"), `${path.basename(sqlFile)} must record reassigned_at`);
  }
});

test("Scenario 9: WebApp dynamicReassignment.ts and MobileApp dynamicReassignment.js have exact algorithm parity", async () => {
  const webMod = await loadBundledModule(webAlgoPath);
  const mobileMod = await loadBundledModule(mobileAlgoPath);

  for (const scenario of webMod.BENCHMARK_SCENARIOS) {
    const webRes = webMod.evaluateMultiCriteriaReassignment(
      scenario.candidates,
      scenario.uncollectedStops,
      scenario.disposalSite,
    );
    const mobRes = mobileMod.evaluateMultiCriteriaReassignment(
      scenario.candidates,
      scenario.uncollectedStops,
      scenario.disposalSite,
    );

    assert.equal(mobRes.isMultiTruck, webRes.isMultiTruck, `Parity mismatch on isMultiTruck in ${scenario.id}`);
    assert.equal(mobRes.selectedCandidate?.vehicleId ?? null, webRes.selectedCandidate?.vehicleId ?? null);
    assert.equal(mobRes.assignments.length, webRes.assignments.length);
    assert.equal(mobRes.unassignedStops.length, webRes.unassignedStops.length);
    for (let i = 0; i < webRes.assignments.length; i++) {
      assert.equal(mobRes.assignments[i].vehicleId, webRes.assignments[i].vehicleId);
      assert.deepEqual(mobRes.assignments[i].assignedBinIds, webRes.assignments[i].assignedBinIds);
      assert.equal(mobRes.assignments[i].projectedLoadPercent, webRes.assignments[i].projectedLoadPercent);
      assert.equal(mobRes.assignments[i].additionalDistanceKm, webRes.assignments[i].additionalDistanceKm);
    }
  }
});
