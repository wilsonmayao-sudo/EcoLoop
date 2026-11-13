import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

test("1. MobileApp HomeScreen.js implements driver-reported capacity and report-full workflow", () => {
  const homeScreenPath = path.join(rootDir, "MobileApp", "src", "screens", "HomeScreen.js");
  const content = fs.readFileSync(homeScreenPath, "utf8");

  assert.ok(
    content.includes("const [driverLoadPercent, setDriverLoadPercent] = useState(25);") ||
      content.includes("driverLoadPercent"),
    "HomeScreen must declare driverLoadPercent state",
  );
  assert.ok(
    content.includes("handleUpdateCapacity"),
    "HomeScreen must provide handleUpdateCapacity handler",
  );
  assert.ok(
    content.includes("Truck Load Level (Driver-Reported)"),
    "HomeScreen must render driver-reported truck load component",
  );
  assert.ok(
    content.includes("REPORT FULL (EMERGENCY REASSIGNMENT)") ||
      content.includes("TRUCK FULL"),
    "HomeScreen must provide report full action button",
  );
  assert.ok(
    content.includes("SWMO_LANDFILL.name") || content.includes("SWMO - Sanitary Landfill"),
    "HomeScreen must direct to SWMO - Sanitary Landfill when full or unloading",
  );
  assert.ok(
    content.includes("load_percent: 100"),
    "HomeScreen must update vehicle load_percent to 100 upon full dispatch",
  );
});

test("2. Dynamic Reassignment algorithm module exists and exports core evaluation algorithms", async () => {
  const dynamicAlgoPath = path.join(
    rootDir,
    "WebApp",
    "src",
    "utils",
    "routing",
    "dynamicReassignment.ts",
  );
  assert.ok(fs.existsSync(dynamicAlgoPath), "dynamicReassignment.ts file must exist");
  const content = fs.readFileSync(dynamicAlgoPath, "utf8");

  assert.ok(content.includes("evaluateMultiCriteriaReassignment"), "Must export evaluateMultiCriteriaReassignment");
  assert.ok(content.includes("evaluateNearestTruckBaseline"), "Must export evaluateNearestTruckBaseline");
  assert.ok(content.includes("runAlgorithmBenchmark"), "Must export runAlgorithmBenchmark");
  assert.ok(content.includes("BENCHMARK_SCENARIOS"), "Must export BENCHMARK_SCENARIOS");
  assert.ok(content.includes("SWMO_LANDFILL_DISPOSAL_SITE"), "Must export SWMO_LANDFILL_DISPOSAL_SITE");
});

test("3. WebApp useOverflowDispatch integrates multi-criteria reassignment and metadata recording", () => {
  const hookPath = path.join(rootDir, "WebApp", "src", "hooks", "useOverflowDispatch.ts");
  const content = fs.readFileSync(hookPath, "utf8");

  assert.ok(
    content.includes("findMultiCriteriaOptimalTruck"),
    "useOverflowDispatch must provide findMultiCriteriaOptimalTruck",
  );
  assert.ok(
    content.includes("evaluateMultiCriteriaReassignment"),
    "useOverflowDispatch must invoke evaluateMultiCriteriaReassignment",
  );
  assert.ok(
    content.includes("reassignment_metadata"),
    "useOverflowDispatch must record reassignment_metadata in event payload",
  );
  assert.ok(
    content.includes("updateVehicleLoadPercent"),
    "useOverflowDispatch must provide updateVehicleLoadPercent",
  );
});

test("4. WebApp separates operational OverflowDispatch from dedicated AlgorithmTesting harness", () => {
  const pagePath = path.join(rootDir, "WebApp", "src", "pages", "OverflowDispatch.tsx");
  const testingPagePath = path.join(rootDir, "WebApp", "src", "pages", "AlgorithmTesting.tsx");
  const panelPath = path.join(
    rootDir,
    "WebApp",
    "src",
    "components",
    "overflow",
    "AlgorithmBenchmarkPanel.tsx",
  );
  assert.ok(fs.existsSync(panelPath), "AlgorithmBenchmarkPanel.tsx component must exist");
  assert.ok(fs.existsSync(testingPagePath), "AlgorithmTesting.tsx dedicated testing file must exist");

  const pageContent = fs.readFileSync(pagePath, "utf8");
  assert.ok(pageContent.includes("selectedAlgorithm"), "OverflowDispatch must allow algorithm selection");
  assert.ok(!pageContent.includes("showBenchmark"), "OverflowDispatch must not include operational benchmark button clutter");

  const testingContent = fs.readFileSync(testingPagePath, "utf8");
  assert.ok(testingContent.includes("runAlgorithmBenchmark"), "AlgorithmTesting must execute runAlgorithmBenchmark");
  assert.ok(testingContent.includes("BENCHMARK_SCENARIOS"), "AlgorithmTesting must support scenario evaluation");
});

test("5. Database migration script exists for dynamic reassignment and capacity monitoring", () => {
  const sqlPath = path.join(rootDir, "database", "dynamic_reassignment_schema.sql");
  assert.ok(fs.existsSync(sqlPath), "dynamic_reassignment_schema.sql migration file must exist");
  const sqlContent = fs.readFileSync(sqlPath, "utf8");

  assert.ok(sqlContent.includes("load_percent"), "SQL must add load_percent column to vehicles");
  assert.ok(sqlContent.includes("reassignment_metadata"), "SQL must add reassignment_metadata to overflow_events");
});

test("6. Dynamic Reassignment algorithm mathematical execution & benchmark verification", async () => {
  const { pathToFileURL } = await import("node:url");
  const esbuildUrl = pathToFileURL(path.join(rootDir, "WebApp", "node_modules", "esbuild", "lib", "main.js")).href;
  const esbuild = (await import(esbuildUrl)).default;
  const tsPath = path.join(rootDir, "WebApp", "src", "utils", "routing", "dynamicReassignment.ts");

  const buildResult = await esbuild.build({
    entryPoints: [tsPath],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
  });

  const code = buildResult.outputFiles[0].text;
  const moduleExports = {};
  const moduleFn = new Function("exports", "require", "module", "__filename", "__dirname", code);
  const fakeModule = { exports: moduleExports };
  moduleFn(moduleExports, (pkg) => {}, fakeModule, tsPath, path.dirname(tsPath));

  const {
    runAlgorithmBenchmark,
    BENCHMARK_SCENARIOS,
    evaluateMultiCriteriaReassignment,
    evaluateNearestTruckBaseline,
  } = fakeModule.exports;

  // Verify Scenario 1 execution
  const sc1 = BENCHMARK_SCENARIOS[0];
  const benchmarkResult = runAlgorithmBenchmark(sc1);

  assert.ok(benchmarkResult, "Benchmark result must be returned");
  assert.ok(benchmarkResult.proposed, "Proposed algorithm result must exist");
  assert.ok(benchmarkResult.baseline, "Baseline algorithm result must exist");
  assert.equal(benchmarkResult.proposed.capacityViolations, 0, "Proposed algorithm must have 0 capacity violations");
  assert.equal(benchmarkResult.proposed.unservedStops, 0, "Proposed algorithm must serve all stops");

  // In Scenario 1, Baseline selects veh-3 purely on approach distance (0.81 km vs 1.25 km).
  // Proposed Multi-Criteria selects veh-4 because it incurs significantly lower detour (1.05 km vs 2.95 km)
  // and shorter dumpsite distance, saving nearly 2 km fleet travel while avoiding veh-2 (109% capacity overload)!
  assert.equal(
    benchmarkResult.baseline.selectedVehicleId,
    "veh-3",
    "Baseline nearest must select veh-3 purely by closest approach distance",
  );
  assert.equal(
    benchmarkResult.proposed.selectedVehicleId,
    "veh-4",
    "Proposed Multi-Criteria must select veh-4 to minimize detour ΔD and total fleet distance",
  );
  assert.ok(
    benchmarkResult.proposed.additionalDistanceKm < benchmarkResult.baseline.additionalDistanceKm,
    "Proposed detour ΔD must be strictly lower than Baseline detour",
  );

  // In Scenario 2, nearest truck (veh-2) has 95% load and only 5% headroom.
  // Baseline selects veh-2 leading to capacity violation, while Proposed avoids it by selecting veh-4!
  const sc2 = BENCHMARK_SCENARIOS[1];
  const res2 = runAlgorithmBenchmark(sc2);
  assert.equal(
    res2.proposed.selectedVehicleId,
    "veh-4",
    "Proposed algorithm must select veh-4 to avoid capacity bottleneck",
  );
  assert.equal(res2.proposed.capacityViolations, 0, "Proposed algorithm must have 0 violations");
});
