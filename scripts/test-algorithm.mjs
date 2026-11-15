#!/usr/bin/env node

/**
 * Standalone Algorithm Testing & Benchmark Runner
 * 
 * Tests the Dynamic Reassignment Multi-Criteria Algorithm against Baseline Nearest Proximity.
 * Usage: node scripts/test-algorithm.mjs
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const esbuildUrl = pathToFileURL(path.join(rootDir, "WebApp", "node_modules", "esbuild", "lib", "main.js")).href;
const esbuild = (await import(esbuildUrl)).default;
const tsPath = path.join(rootDir, "WebApp", "src", "utils", "routing", "dynamicReassignment.ts");

const buildResult = await esbuild.build({
  entryPoints: [tsPath],
  bundle: true,
  write: false,
  format: "cjs",
});

const bundleCode = buildResult.outputFiles[0].text;
const moduleExports = {};
const moduleWrapper = new Function("module", "exports", bundleCode);
const fakeModule = { exports: moduleExports };
moduleWrapper(fakeModule, moduleExports);

const {
  BENCHMARK_SCENARIOS,
  runAlgorithmBenchmark,
  SWMO_LANDFILL_DISPOSAL_SITE,
} = fakeModule.exports;

console.log("=".repeat(80));
console.log("ECOLOOP DYNAMIC REASSIGNMENT ALGORITHM BENCHMARK & DEFENSE MATRIX TEST");
console.log("=".repeat(80));
console.log(`Disposal Terminal: ${SWMO_LANDFILL_DISPOSAL_SITE.name} (${SWMO_LANDFILL_DISPOSAL_SITE.coordinate.lat}, ${SWMO_LANDFILL_DISPOSAL_SITE.coordinate.lng})\n`);

let totalPassed = 0;
let scenarioCount = 0;

for (const scenario of BENCHMARK_SCENARIOS) {
  scenarioCount++;
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`SCENARIO ${scenarioCount}: ${scenario.name}`);
  console.log(`Description: ${scenario.description}`);
  console.log(`Uncollected Stops: ${scenario.uncollectedStops.length} | Candidate Trucks: ${scenario.candidates.length}`);
  console.log(`--------------------------------------------------------------------------------`);

  const t0 = performance.now();
  const comparison = runAlgorithmBenchmark(scenario);
  const runtimeMs = (performance.now() - t0).toFixed(2);

  const { baseline, proposed, improvement, evaluations } = comparison;

  console.log("\n[1] METRIC COMPARISON MATRIX:");
  console.log(
    `  Dimension                   | Baseline (Nearest)     | Proposed (Multi-Criteria) | Delta / Improvement`
  );
  console.log(`  ----------------------------|------------------------|---------------------------|--------------------`);
  console.log(
    `  Selected Assisting Truck    | ${baseline.selectedVehicleLabel.padEnd(22)} | ${proposed.selectedVehicleLabel.padEnd(25)} | ${proposed.selectedVehicleLabel !== baseline.selectedVehicleLabel ? "Different (Optimized)" : "Same Vehicle"}`
  );
  console.log(
    `  Total Fleet Travel (km)     | ${(baseline.totalFleetDistanceKm + " km").padEnd(22)} | ${(proposed.totalFleetDistanceKm + " km").padEnd(25)} | -${improvement.distanceSavedKm} km`
  );
  console.log(
    `  Additional Detour ΔD (km)   | ${("+" + baseline.additionalDistanceKm + " km").padEnd(22)} | ${("+" + proposed.additionalDistanceKm + " km").padEnd(25)} | ${improvement.distanceImprovementPercent}% reduction`
  );
  console.log(
    `  Capacity Violations         | ${String(baseline.capacityViolations).padEnd(22)} | ${String(proposed.capacityViolations).padEnd(25)} | ${proposed.capacityViolations === 0 ? "PASSED (0 overloads)" : "FAILED"}`
  );
  console.log(
    `  Processing Latency (ms)     | ${(baseline.processingTimeMs + " ms").padEnd(22)} | ${(proposed.processingTimeMs + " ms").padEnd(25)} | Runtime: ${runtimeMs} ms`
  );
  console.log(
    `  Avg Fleet Utilization (%)   | ${(baseline.avgFleetUtilizationPercent + "%").padEnd(22)} | ${(proposed.avgFleetUtilizationPercent + "%").padEnd(25)} | Balanced load distribution`
  );

  console.log("\n[2] CANDIDATE SCORING BREAKDOWN:");
  console.log(`  Rank | Vehicle                | Driver Load | Detour ΔD | MRF Dist | Capacity Penalty | Composite Score | Recommendation`);
  console.log(`  -----|------------------------|-------------|-----------|----------|------------------|-----------------|---------------`);
  for (const ev of evaluations) {
    const rankStr = ev.eligible ? `#${ev.rank}` : "—";
    const labelStr = ev.label.padEnd(22);
    const loadStr = (ev.projectedLoadPercent + "%").padEnd(11);
    const detourStr = ("+" + ev.additionalDistanceKm + " km").padEnd(9);
    const dumpsiteStr = (ev.distanceToDumpsiteKm + " km").padEnd(8);
    const capPenStr = String(ev.normalizedCapacityScore).padEnd(16);
    const scoreStr = (ev.eligible ? String(ev.compositeScore) : "Infeasible").padEnd(15);
    const statusStr = ev.rank === 1 ? "OPTIMAL CHOICE" : (!ev.eligible ? ev.ineligibleReason : "Suboptimal");
    console.log(`   ${rankStr.padEnd(3)} | ${labelStr} | ${loadStr} | ${detourStr} | ${dumpsiteStr} | ${capPenStr} | ${scoreStr} | ${statusStr}`);
  }

  // Verification assertions
  const capacityPassed = proposed.capacityViolations === 0;
  const detourOrFeasibilityPassed =
    baseline.capacityViolations > 0
      ? proposed.capacityViolations === 0
      : proposed.additionalDistanceKm <= baseline.additionalDistanceKm;
  const executionPassed = proposed.processingTimeMs < 1000;

  if (capacityPassed && detourOrFeasibilityPassed && executionPassed) {
    totalPassed++;
    console.log(`\n  >> RESULT: PASSED (Feasible, Optimized Selection, Sub-second Execution)`);
  } else {
    console.log(`\n  >> RESULT: FAILED (Checks not met)`);
  }
  console.log("");
}

console.log("=".repeat(80));
console.log(`SUMMARY: ${totalPassed} / ${scenarioCount} Scenarios Passed All Scientific & Operational Constraints.`);
console.log("=".repeat(80));

if (totalPassed === scenarioCount) {
  process.exit(0);
} else {
  process.exit(1);
}
