import { SWMO_HIDEOUT } from "./navigationRoute";

const INITIAL_ZOOM = 13;
const MAPBOX_GL = "https://api.mapbox.com/mapbox-gl-js/v2.15.0";

/**
 * Resolve Mapbox public access token across direct EXPO_PUBLIC_ env and Expo Constants shapes
 * without short-circuiting when `expoConfig.extra` is an empty object.
 */
export function resolveMobileMapboxToken(constantsObj, envToken) {
  const candidates = [
    envToken,
    constantsObj?.expoConfig?.extra?.mapboxAccessToken,
    constantsObj?.expoConfig?.extra?.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN,
    constantsObj?.manifest2?.extra?.expoClient?.extra?.mapboxAccessToken,
    constantsObj?.manifest2?.extra?.expoClient?.extra?.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN,
    constantsObj?.manifest?.extra?.mapboxAccessToken,
    constantsObj?.manifest?.extra?.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

/**
 * Mapbox GL JS inside WebView.
 * Uses `streets-v12` (reliable in RN WebView). `navigation-day-v1` often shows a blank base map here
 * when tiles are 403 (token URL restrictions) or the style fails partially.
 * Token: Mapbox **default public** token; if you use URL restrictions, allow requests with no / mobile referrer
 * or the WebView origin (often `about:blank` / `file://`), or tiles will not load.
 */
export function getMapboxNavigationHtml(accessToken) {
  const tokenJson = JSON.stringify(accessToken ?? "");
  const lat = SWMO_HIDEOUT.lat;
  const lng = SWMO_HIDEOUT.lng;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link href="${MAPBOX_GL}/mapbox-gl.css" rel="stylesheet" />
  <style>html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#eef2f7;}</style>
</head>
<body>
  <div id="map"></div>
  <script>
    var STYLE_URL = 'mapbox://styles/mapbox/streets-v12';
    var MAX_SCRIPT_RETRIES = 3;
    var scriptAttempts = 0;
    var styleRecoveryTimer = null;
    var loadingScript = false;

    function postMsg(prefix, msg) {
      try {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(msg ? (prefix + ':' + String(msg)) : prefix);
        }
      } catch (x) {}
    }
    function safeResize() {
      try {
        if (window.map && window.map.resize) window.map.resize();
      } catch (e) {}
    }
    function reapplyLayers() {
      try {
        if (typeof window.__ecoloopReapplyLayers === 'function') {
          window.__ecoloopReapplyLayers();
        }
      } catch (e) {}
    }
    function scheduleStyleRecovery() {
      if (styleRecoveryTimer || !window.map) return;
      styleRecoveryTimer = setTimeout(function () {
        styleRecoveryTimer = null;
        try {
          if (window.map && typeof window.map.isStyleLoaded === 'function' && !window.map.isStyleLoaded()) {
            window.map.setStyle(STYLE_URL);
          }
        } catch (e) {}
      }, 4000);
    }
    function initMap() {
      if (window.map || !window.mapboxgl) return;
      try {
        mapboxgl.accessToken = ${tokenJson};
        window.map = new mapboxgl.Map({
          container: 'map',
          style: STYLE_URL,
          center: [${lng}, ${lat}],
          zoom: ${INITIAL_ZOOM},
          attributionControl: true,
          fadeDuration: 150
        });
        window.map.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: true }), 'top-left');
        window.addEventListener('resize', safeResize);

        function onReady() {
          if (styleRecoveryTimer) { clearTimeout(styleRecoveryTimer); styleRecoveryTimer = null; }
          safeResize();
          setTimeout(safeResize, 100);
          setTimeout(safeResize, 400);
          reapplyLayers();
          postMsg('mapbox-ready');
          postMsg('mapbox-recovered');
        }

        window.map.on('load', onReady);
        window.map.on('style.load', function () {
          if (styleRecoveryTimer) { clearTimeout(styleRecoveryTimer); styleRecoveryTimer = null; }
          reapplyLayers();
          safeResize();
          postMsg('mapbox-recovered');
        });
        window.map.on('idle', function () {
          if (window.map && typeof window.map.isStyleLoaded === 'function' && window.map.isStyleLoaded()) {
            postMsg('mapbox-recovered');
          }
        });
        window.map.on('error', function (e) {
          var err = e && e.error ? e.error : {};
          var m = err.message ? String(err.message) : '';
          var name = err.name ? String(err.name) : '';
          var status = typeof err.status === 'number' ? err.status : null;
          if (name === 'AbortError' || /\\b(abort|aborted|cancel|canceled|cancelled)\\b/i.test(m)) return;
          if (status === 401 || status === 403 || /unauthorized|forbidden|access token/i.test(m)) {
            postMsg('mapbox-auth-error', (m || 'Mapbox token rejected') + (status ? ' (' + status + ')' : ''));
            return;
          }
          if (m || status) {
            postMsg('mapbox-transient-error', m || ('Map tile delayed (' + status + ')'));
          }
          if (window.map && typeof window.map.isStyleLoaded === 'function' && !window.map.isStyleLoaded()) {
            scheduleStyleRecovery();
          }
        });

        try {
          var canvas = window.map.getCanvas && window.map.getCanvas();
          if (canvas) {
            canvas.addEventListener('webglcontextlost', function (ev) {
              if (ev && ev.preventDefault) ev.preventDefault();
              postMsg('mapbox-transient-error', 'Restoring map display...');
            });
            canvas.addEventListener('webglcontextrestored', function () {
              safeResize();
              reapplyLayers();
              if (window.map && window.map.triggerRepaint) window.map.triggerRepaint();
              postMsg('mapbox-recovered');
            });
          }
        } catch (ce) {}
      } catch (e) {
        postMsg('mapbox-error', e && e.message ? e.message : 'init failed');
      }
    }

    function loadMapboxScript() {
      if (window.mapboxgl) {
        initMap();
        return;
      }
      if (loadingScript) return;
      loadingScript = true;
      scriptAttempts += 1;
      var s = document.createElement('script');
      s.src = '${MAPBOX_GL}/mapbox-gl.js';
      s.async = true;
      s.onload = function () {
        loadingScript = false;
        initMap();
      };
      s.onerror = function () {
        loadingScript = false;
        s.remove();
        if (scriptAttempts < MAX_SCRIPT_RETRIES) {
          postMsg('mapbox-transient-error', 'Retrying Mapbox map load...');
          setTimeout(loadMapboxScript, 1200 * scriptAttempts);
        } else {
          postMsg('mapbox-error', 'Unable to download Mapbox library. Check connection and tap to retry.');
        }
      };
      document.head.appendChild(s);
    }

    window.__ecoloopRetryMap = function () {
      if (!window.mapboxgl) {
        scriptAttempts = 0;
        loadMapboxScript();
        return;
      }
      if (!window.map) {
        initMap();
        return;
      }
      try {
        if (typeof window.map.isStyleLoaded === 'function' && !window.map.isStyleLoaded()) {
          window.map.setStyle(STYLE_URL);
        } else {
          safeResize();
          if (window.map.triggerRepaint) window.map.triggerRepaint();
          reapplyLayers();
        }
      } catch (e) {}
    };

    window.addEventListener('online', function () {
      window.__ecoloopRetryMap();
    });

    loadMapboxScript();
  </script>
</body>
</html>`;
}

/**
 * Injected after Mapbox style loads. Route points are [lat,lng]; GeoJSON needs [lng,lat].
 * @param {object} p
 * @param {string} p.routeStartJson — JSON of {{lat,lng}} first waypoint of the route (driver or SWMO fallback)
 * @param {string} p.referenceDepotJson — JSON of SWMO for optional reference marker
 * @param {boolean} p.driverIsRouteOrigin — when true, brown "start" is omitted (driver = user marker)
 * @param {boolean} p.showReferenceDepot — show small SWMO reference when driver origin and far from yard
 */
export function buildMapboxLayersScript({
  followTruck,
  binsJson,
  lineJson,
  userJson,
  routeStartJson,
  driverIsRouteOrigin,
  showLandfillMarker = false,
  landfillJson = JSON.stringify(SWMO_HIDEOUT),
}) {
  const follow = followTruck ? "true" : "false";
  const drv = driverIsRouteOrigin ? "true" : "false";
  const showLf = showLandfillMarker ? "true" : "false";
  return `
(function(){
  function apply() {
    try {
      var m = window.map;
      if (!m) return;
      if (!m.isStyleLoaded()) {
        if (!window._ecoloopStyleWaiter) {
          window._ecoloopStyleWaiter = true;
          m.once('style.load', function () {
            window._ecoloopStyleWaiter = false;
            try { if (typeof window.__ecoloopReapplyLayers === 'function') window.__ecoloopReapplyLayers(); } catch (e) {}
          });
        }
        return;
      }
      ['route-line','bins-circles','user','route-start-dot','ref-depot-dot','landfill-dot'].forEach(function(id){
        try { if (m.getLayer(id)) m.removeLayer(id); } catch(e){}
      });
      ['route-src','bins-src','user-src','route-start-src','ref-depot-src','landfill-src'].forEach(function(id){
        try { if (m.getSource(id)) m.removeSource(id); } catch(e){}
      });
      if (window._activePopup) { try { window._activePopup.remove(); } catch(e){} window._activePopup = null; }
      if (window._landfillMarker) { try { window._landfillMarker.remove(); } catch(e){} window._landfillMarker = null; }
      if (window._stopMarker) { try { window._stopMarker.remove(); } catch(e){} window._stopMarker = null; }

      var routeStart = ${routeStartJson};
      var bins = ${binsJson};
      var line = ${lineJson};
      var u = ${userJson};
      var follow = ${follow};
      var driverAsStart = ${drv};
      var showLandfill = ${showLf};
      var landfill = ${landfillJson};

      if (!driverAsStart && routeStart && routeStart.lat != null) {
        m.addSource('route-start-src', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [routeStart.lng, routeStart.lat] } } });
        m.addLayer({ id: 'route-start-dot', type: 'circle', source: 'route-start-src', paint: { 'circle-radius': 9, 'circle-color': '#b45309', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
      }

      if (line && line.length >= 2) {
        var coords = line.map(function(p){ return [p[1], p[0]]; });
        m.addSource('route-src', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
        m.addLayer({ id: 'route-line', type: 'line', source: 'route-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': showLandfill ? '#047857' : '#0d9488', 'line-width': 5, 'line-opacity': 0.94 } });
      }

      if (showLandfill && landfill && landfill.lat != null) {
        m.addSource('landfill-src', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [landfill.lng, landfill.lat] } } });
        m.addLayer({ id: 'landfill-dot', type: 'circle', source: 'landfill-src', paint: { 'circle-radius': 12, 'circle-color': '#047857', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
        var lfEl = document.createElement('div');
        lfEl.style.cssText = 'background:#047857;color:#fff;border-radius:12px;padding:4px 9px;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);white-space:nowrap;display:flex;align-items:center;gap:4px;';
        lfEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"/><path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"/><path d="m14 16-3 3 3 3"/><path d="M8.293 13.596 7.196 9.5 3.1 10.598"/><path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843"/><path d="m13.378 9.633 4.096 1.098 1.097-4.096"/></svg>';
        var lfText = document.createElement('span');
        lfText.textContent = 'SWMO Sanitary Landfill';
        lfEl.appendChild(lfText);
        window._landfillMarker = new mapboxgl.Marker({ element: lfEl, anchor: 'bottom', offset: [0, -14] })
          .setLngLat([landfill.lng, landfill.lat])
          .addTo(m);
      } else if (bins && bins.length > 0) {
        var activeBin = bins[0];
        m.addSource('bins-src', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: { label: String(activeBin.id) }, geometry: { type: 'Point', coordinates: [activeBin.lng, activeBin.lat] } }]
          }
        });
        m.addLayer({ id: 'bins-circles', type: 'circle', source: 'bins-src', paint: {
          'circle-radius': 11,
          'circle-color': '#ca8a04',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff'
        }});
        var stopEl = document.createElement('div');
        stopEl.style.cssText = 'background:#b45309;color:#fff;border-radius:12px;padding:3px 8px;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);white-space:nowrap;display:flex;align-items:center;gap:4px;';
        stopEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>';
        var stopText = document.createElement('span');
        stopText.textContent = String(activeBin.id);
        stopEl.appendChild(stopText);
        window._stopMarker = new mapboxgl.Marker({ element: stopEl, anchor: 'bottom', offset: [0, -13] })
          .setLngLat([activeBin.lng, activeBin.lat])
          .addTo(m);
      }

      if (u && u.lat != null && u.lng != null) {
        m.addSource('user-src', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [u.lng, u.lat] } } });
        m.addLayer({ id: 'user', type: 'circle', source: 'user-src', paint: { 'circle-radius': 12, 'circle-color': '#2563eb', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
      }

      if (follow && u && u.lat != null && u.lng != null) {
        m.easeTo({ center: [u.lng, u.lat], zoom: 17, duration: 0 });
      } else {
        var bb = new mapboxgl.LngLatBounds();
        var hasBounds = false;
        if (showLandfill && landfill && landfill.lat != null) { bb.extend([landfill.lng, landfill.lat]); hasBounds = true; }
        if (!showLandfill && bins && bins.length > 0) { bb.extend([bins[0].lng, bins[0].lat]); hasBounds = true; }
        if (u && u.lat != null && u.lng != null) { bb.extend([u.lng, u.lat]); hasBounds = true; }
        else if (routeStart && routeStart.lat != null) { bb.extend([routeStart.lng, routeStart.lat]); hasBounds = true; }
        if (line && line.length) line.forEach(function(p){ bb.extend([p[1], p[0]]); hasBounds = true; });
        if (hasBounds) {
          m.fitBounds(bb, { padding: { top: 88, bottom: 210, left: 32, right: 32 }, maxZoom: 16, duration: 0 });
        }
      }
    } catch(e) {}
  }
  window.__ecoloopReapplyLayers = apply;
  apply();
  true;
})();
`;
}
