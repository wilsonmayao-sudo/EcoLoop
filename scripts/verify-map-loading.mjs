import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const esbuild = require(path.resolve("WebApp/node_modules/esbuild"));

const root = process.cwd();
const tmpDir = path.resolve(root, "WebApp/.tmp-verify-map");
fs.mkdirSync(tmpDir, { recursive: true });

function compileTsToEsm(relPath, outName) {
  const full = path.resolve(root, relPath);
  const res = esbuild.buildSync({
    entryPoints: [full],
    bundle: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile: path.join(tmpDir, outName),
    write: true,
  });
  if (res.errors?.length) {
    throw new Error(`esbuild failed for ${relPath}: ${JSON.stringify(res.errors)}`);
  }
  return path.join(tmpDir, outName);
}

try {
  const runtimeJs = compileTsToEsm("WebApp/src/utils/mapboxRuntime.ts", "mapboxRuntime.mjs");
  const settingsJs = compileTsToEsm("WebApp/src/utils/systemSettings.ts", "systemSettings.mjs");

  const {
    MISSING_MAPBOX_TOKEN_MESSAGE,
    classifyMapboxError,
    safeResizeMap,
    recoverMapboxStyleInPlace,
  } = await import(pathToFileURL(runtimeJs).href);
  const { syncRuntimeSystemSettings, subscribeRuntimeSettings } = await import(
    pathToFileURL(settingsJs).href
  );

  assert.match(MISSING_MAPBOX_TOKEN_MESSAGE, /VITE_MAPBOX_ACCESS_TOKEN/);

  // 1. Mapbox error classification separates ignore/transient/auth/webgl
  assert.equal(classifyMapboxError({ error: { name: "AbortError", message: "The operation was aborted." } }).kind, "ignore");
  assert.equal(classifyMapboxError({ error: { message: "Request cancelled" } }).kind, "ignore");
  assert.equal(classifyMapboxError({ error: { message: "Failed to fetch" } }).kind, "transient");
  assert.equal(classifyMapboxError({ error: { status: 503, message: "Service Unavailable" } }).kind, "transient");
  assert.equal(classifyMapboxError({ error: { status: 429, message: "Too Many Requests" } }).kind, "transient");
  assert.equal(classifyMapboxError({ error: { status: 403, message: "Forbidden" } }).kind, "auth");
  assert.equal(classifyMapboxError({ error: { status: 401, message: "Unauthorized" } }).kind, "auth");
  assert.equal(classifyMapboxError({ error: { message: "Failed to initialize WebGL" } }).kind, "webgl");

  // 2. Safe resize skips zero-sized containers and resizes laid-out ones
  let resizeCalls = 0;
  const mockMap = {
    resize: () => {
      resizeCalls += 1;
    },
    repaintCalls: 0,
    styleSetTo: null,
    removed: false,
    loadedFlag: false,
    isStyleLoaded() {
      return this.loadedFlag;
    },
    setStyle(url) {
      this.styleSetTo = url;
    },
    triggerRepaint() {
      this.repaintCalls += 1;
    },
    remove() {
      this.removed = true;
    },
  };
  safeResizeMap(mockMap, { clientWidth: 0, clientHeight: 400 });
  assert.equal(resizeCalls, 0);
  safeResizeMap(mockMap, { clientWidth: 640, clientHeight: 400 });
  assert.equal(resizeCalls, 1);

  // 3. In-place recovery reloads style when not loaded, repaints when loaded, never removes map
  recoverMapboxStyleInPlace(mockMap, "mapbox://styles/mapbox/streets-v12");
  assert.equal(mockMap.styleSetTo, "mapbox://styles/mapbox/streets-v12");
  assert.equal(mockMap.removed, false);

  mockMap.loadedFlag = true;
  recoverMapboxStyleInPlace(mockMap, "mapbox://styles/mapbox/streets-v12");
  assert.equal(mockMap.repaintCalls, 1);
  assert.equal(resizeCalls, 2);
  assert.equal(mockMap.removed, false);

  // 4. syncRuntimeSystemSettings skips duplicate notifications when settings are unchanged
  let listenerCalls = 0;
  const unsub = subscribeRuntimeSettings(() => {
    listenerCalls += 1;
  });
  const sampleSettings = [
    {
      key: "map_defaults",
      value: {
        mapboxStyle: "navigation-day-v1",
        defaultZoom: 14,
        centerLatitude: 13.6218,
        centerLongitude: 123.1948,
        showLandfillOnLiveMap: true,
      },
    },
  ];
  syncRuntimeSystemSettings(sampleSettings);
  assert.equal(listenerCalls, 1);
  syncRuntimeSystemSettings(sampleSettings);
  assert.equal(listenerCalls, 1, "Unchanged system settings must not trigger map re-renders");
  unsub();

  // 5. Strict Mapbox-only & no-Leaflet/OSM-fallback verification across WebApp & MobileApp
  const indexHtml = fs.readFileSync(path.resolve(root, "WebApp/index.html"), "utf8");
  assert.match(indexHtml, /name="referrer"\s+content="strict-origin-when-cross-origin"/);

  const mapboxOnlyComponents = [
    "WebApp/src/utils/mapboxRuntime.ts",
    "WebApp/src/components/maps/LiveFleetMap.tsx",
    "WebApp/src/components/maps/BinLocationPicker.tsx",
    "WebApp/src/components/maps/TrafficRouteMapPreview.tsx",
    "WebApp/src/components/reports/ReportLocationMap.tsx",
    "MobileApp/src/utils/mapboxWebMap.js",
  ];
  for (const rel of mapboxOnlyComponents) {
    const src = fs.readFileSync(path.resolve(root, rel), "utf8");
    assert.doesNotMatch(src, /unpkg\.com\/leaflet/i, `${rel} must not load Leaflet`);
    assert.doesNotMatch(src, /ensureLeaflet/, `${rel} must not contain ensureLeaflet`);
    assert.doesNotMatch(src, /openstreetmap\.org\/export\/embed/i, `${rel} must not embed OSM iframe`);
    assert.doesNotMatch(src, /getLeafletMapHtml|buildLeafletLayersScript/, `${rel} must not define Leaflet helpers`);
  }

  const liveFleetSrc = fs.readFileSync(path.resolve(root, "WebApp/src/components/maps/LiveFleetMap.tsx"), "utf8");
  assert.match(liveFleetSrc, /webglcontextlost/);
  assert.match(liveFleetSrc, /webglcontextrestored/);
  assert.match(liveFleetSrc, /recoverMapboxStyleInPlace/);
  assert.match(liveFleetSrc, /map\.isStyleLoaded\(\)/);
  assert.match(liveFleetSrc, /\}, \[mapboxToken, retryNonce\]\);/);
  assert.doesNotMatch(liveFleetSrc, /\}, \[mapboxToken, mapDefaults\.mapboxStyle/);

  const pickerSrc = fs.readFileSync(path.resolve(root, "WebApp/src/components/maps/BinLocationPicker.tsx"), "utf8");
  assert.match(pickerSrc, /ResizeObserver/);
  assert.match(pickerSrc, /webglcontextlost/);
  assert.match(pickerSrc, /\}, \[mapboxToken, retryNonce\]\);/);

  const previewSrc = fs.readFileSync(path.resolve(root, "WebApp/src/components/maps/TrafficRouteMapPreview.tsx"), "utf8");
  assert.match(previewSrc, /\}, \[token, retryNonce\]\);/);
  assert.match(previewSrc, /existingSource\.setData\(data\)/);
  assert.match(previewSrc, /ResizeObserver/);
  assert.match(previewSrc, /webglcontextlost/);

  const reportMapSrc = fs.readFileSync(path.resolve(root, "WebApp/src/components/reports/ReportLocationMap.tsx"), "utf8");
  assert.match(reportMapSrc, /new mapboxgl\.Map/);
  assert.match(reportMapSrc, /webglcontextlost/);

  const areaSrc = fs.readFileSync(path.resolve(root, "WebApp/src/pages/AreaManagement.tsx"), "utf8");
  assert.match(areaSrc, /onlineRouteRetryTick/);
  const liveMonSrc = fs.readFileSync(path.resolve(root, "WebApp/src/pages/LiveMonitoring.tsx"), "utf8");
  assert.match(liveMonSrc, /onlineRouteRetryTick/);

  const mobHtmlSrc = fs.readFileSync(path.resolve(root, "MobileApp/src/utils/mapboxWebMap.js"), "utf8");
  assert.match(mobHtmlSrc, /MAX_SCRIPT_RETRIES/);
  assert.match(mobHtmlSrc, /mapbox-transient-error/);
  assert.match(mobHtmlSrc, /mapbox-auth-error/);
  assert.match(mobHtmlSrc, /mapbox-recovered/);
  assert.match(mobHtmlSrc, /window\.__ecoloopRetryMap/);
  assert.match(mobHtmlSrc, /window\.__ecoloopReapplyLayers/);
  assert.match(mobHtmlSrc, /webglcontextlost/);
  assert.match(mobHtmlSrc, /manifest2\?\.extra\?\.expoClient\?\.extra/);

  const mobNavSrc = fs.readFileSync(path.resolve(root, "MobileApp/src/screens/MapNavigateScreen.js"), "utf8");
  assert.match(mobNavSrc, /resolveMobileMapboxToken\s*\(\s*Constants,\s*process\.env\.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN/s);
  assert.match(mobNavSrc, /onRenderProcessGone/);
  assert.match(mobNavSrc, /onContentProcessDidTerminate/);
  assert.match(mobNavSrc, /mapbox-recovered/);
  assert.match(mobNavSrc, /__ecoloopRetryMap/);
  assert.match(mobNavSrc, /baseUrl:\s*"https:\/\/localhost"/);
  assert.match(mobNavSrc, /React\.memo\s*\(/);
  assert.doesNotMatch(mobNavSrc, /getLeafletMapHtml|buildLeafletLayersScript|leaflet-osm/);

  // 6. WebApp built bundle verification (Vite statically inlines VITE_MAPBOX_ACCESS_TOKEN)
  const buildAssetsDir = path.resolve(root, "WebApp/build/assets");
  assert.ok(fs.existsSync(buildAssetsDir), "WebApp/build/assets must exist; run npm run build first");
  const builtJsFiles = fs.readdirSync(buildAssetsDir).filter((f) => f.endsWith(".js"));
  const runtimeBundleFiles = builtJsFiles.filter((f) => {
    const content = fs.readFileSync(path.join(buildAssetsDir, f), "utf8");
    return content.includes("Mapbox access token (VITE_MAPBOX_ACCESS_TOKEN) is not configured.");
  });
  assert.equal(runtimeBundleFiles.length, 1, "Expected exactly one compiled asset defining mapboxRuntime");
  const runtimeBundleSrc = fs.readFileSync(path.join(buildAssetsDir, runtimeBundleFiles[0]), "utf8");
  assert.match(
    runtimeBundleSrc,
    /pk\.[A-Za-z0-9_-]{10,}/,
    "Compiled WebApp mapboxRuntime bundle must inline the pk.* Mapbox token",
  );
  assert.doesNotMatch(
    runtimeBundleSrc,
    /\.env\??\.VITE_MAPBOX_ACCESS_TOKEN/,
    "Compiled WebApp mapboxRuntime bundle must not leave unreplaced import.meta.env.VITE_MAPBOX_ACCESS_TOKEN",
  );

  // 7. MobileApp token resolver verification across all Constants shapes + app.config.js
  const mobWebMapOut = path.join(tmpDir, "mapboxWebMap.mjs");
  await esbuild.build({
    entryPoints: [path.resolve(root, "MobileApp/src/utils/mapboxWebMap.js")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile: mobWebMapOut,
    plugins: [
      {
        name: "stub-navigation-route",
        setup(build) {
          build.onResolve({ filter: /^\.\/navigationRoute$/ }, () => ({
            path: "navigationRoute",
            namespace: "stub-nav",
          }));
          build.onLoad({ filter: /.*/, namespace: "stub-nav" }, () => ({
            contents: "export const SWMO_HIDEOUT = { lat: 13.6212151, lng: 123.2576126 };",
            loader: "js",
          }));
        },
      },
    ],
  });
  const { resolveMobileMapboxToken, getMapboxNavigationHtml } = await import(pathToFileURL(mobWebMapOut).href);

  const sampleNavHtml = getMapboxNavigationHtml("pk.test_token_1234567890");
  assert.match(sampleNavHtml, /id="map-container"/, "Mapbox HTML must use id=\"map-container\" to avoid window.map DOM collision");
  assert.match(sampleNavHtml, /container:\s*'map-container'/, "Mapbox GL must mount into container 'map-container'");
  assert.doesNotMatch(sampleNavHtml, /id="map"/, "Mapbox HTML must not use id=\"map\" which shadows window.map");
  assert.match(sampleNavHtml, /if\s*\(mapInstance\s*\|\|\s*!window\.mapboxgl\)\s*return;/, "initMap must guard on explicit mapInstance rather than window.map");

  assert.equal(
    resolveMobileMapboxToken({ expoConfig: { extra: {} } }, "  pk.env_token_123  "),
    "pk.env_token_123",
    "Direct EXPO_PUBLIC envToken must resolve even when expoConfig.extra is empty",
  );
  assert.equal(
    resolveMobileMapboxToken(
      {
        expoConfig: { extra: {} },
        manifest2: { extra: { expoClient: { extra: { mapboxAccessToken: "pk.manifest2_123" } } } },
      },
      undefined,
    ),
    "pk.manifest2_123",
    "manifest2 extra must resolve when expoConfig.extra is an empty object",
  );
  assert.equal(
    resolveMobileMapboxToken(
      {
        expoConfig: { extra: {} },
        manifest2: { extra: { expoClient: { extra: {} } } },
        manifest: { extra: { mapboxAccessToken: "pk.manifest1_123" } },
      },
      "",
    ),
    "pk.manifest1_123",
    "manifest extra fallback must resolve when expoConfig and manifest2 extras are empty",
  );

  const mobileAppConfig = require(path.resolve(root, "MobileApp/app.config.js"));
  const resolvedAppConfig = mobileAppConfig({ config: {} });
  const cfgToken = resolvedAppConfig?.extra?.mapboxAccessToken ?? "";
  assert.ok(
    typeof cfgToken === "string" && cfgToken.startsWith("pk.") && cfgToken.length >= 20,
    "MobileApp/app.config.js must resolve a non-empty pk.* extra.mapboxAccessToken",
  );

  console.log("ALL 7 MAPBOX TOKEN, BUNDLE & RECOVERY CHECKS PASSED");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
