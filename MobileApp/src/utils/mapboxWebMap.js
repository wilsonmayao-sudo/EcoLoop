import { SWMO_HIDEOUT } from "./navigationRoute";

const INITIAL_ZOOM = 13;
const MAPBOX_GL = "https://api.mapbox.com/mapbox-gl-js/v2.15.0";

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
  <script src="${MAPBOX_GL}/mapbox-gl.js"></script>
  <style>html,body,#map{margin:0;padding:0;height:100%;width:100%;}</style>
</head>
<body>
  <div id="map"></div>
  <script>
    function postErr(msg) {
      try {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('mapbox-error:' + String(msg || 'error'));
      } catch (x) {}
    }
    function safeResize() {
      try {
        if (window.map && window.map.resize) window.map.resize();
      } catch (e) {}
    }
    try {
      mapboxgl.accessToken = ${tokenJson};
      window.map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [${lng}, ${lat}],
        zoom: ${INITIAL_ZOOM},
        attributionControl: true
      });
      window.map.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: true }), 'top-left');
      window.addEventListener('resize', safeResize);
      window.map.on('load', function () {
        safeResize();
        setTimeout(safeResize, 100);
        setTimeout(safeResize, 400);
        try {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage('mapbox-ready');
          }
        } catch (e) {}
      });
      window.map.on('error', function (e) {
        var m = (e && e.error && e.error.message) ? e.error.message : 'map error';
        if (e && e.error && typeof e.error.status === 'number') m += ' (' + e.error.status + ')';
        postErr(m);
      });
    } catch (e) {
      postErr(e && e.message ? e.message : 'init failed');
    }
  </script>
</body>
</html>`;
}

export function getLeafletMapHtml() {
  const lat = SWMO_HIDEOUT.lat;
  const lng = SWMO_HIDEOUT.lng;
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; }
    html, body, #map { height: 100%; width: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map').setView([${lat}, ${lng}], ${INITIAL_ZOOM});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19
    }).addTo(map);
    window._layers = [];
  </script>
</body>
</html>`;
}

/**
 * Injected after Mapbox style loads. Leaflet route points are [lat,lng]; GeoJSON needs [lng,lat].
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
  referenceDepotJson,
  driverIsRouteOrigin,
  showReferenceDepot,
}) {
  const follow = followTruck ? "true" : "false";
  const drv = driverIsRouteOrigin ? "true" : "false";
  const showRef = showReferenceDepot ? "true" : "false";
  return `
(function(){
  try {
    var m = window.map;
    if (!m || !m.isStyleLoaded()) return;
    ['route-line','bins-circles','user','route-start-dot','ref-depot-dot'].forEach(function(id){
      try { if (m.getLayer(id)) m.removeLayer(id); } catch(e){}
    });
    ['route-src','bins-src','user-src','route-start-src','ref-depot-src'].forEach(function(id){
      try { if (m.getSource(id)) m.removeSource(id); } catch(e){}
    });
    var routeStart = ${routeStartJson};
    var refDepot = ${referenceDepotJson};
    var bins = ${binsJson};
    var line = ${lineJson};
    var u = ${userJson};
    var follow = ${follow};
    var driverAsStart = ${drv};
    var showRef = ${showRef};

    if (!driverAsStart && routeStart && routeStart.lat != null) {
      m.addSource('route-start-src', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [routeStart.lng, routeStart.lat] } } });
      m.addLayer({ id: 'route-start-dot', type: 'circle', source: 'route-start-src', paint: { 'circle-radius': 11, 'circle-color': '#b45309', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
    }
    if (showRef && refDepot && refDepot.lat != null) {
      m.addSource('ref-depot-src', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [refDepot.lng, refDepot.lat] } } });
      m.addLayer({ id: 'ref-depot-dot', type: 'circle', source: 'ref-depot-src', paint: { 'circle-radius': 6, 'circle-color': '#64748b', 'circle-opacity': 0.85, 'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff' } });
    }

    var binFeatures = bins.map(function(b){
      return { type: 'Feature', properties: { isNext: !!b.isNext, label: String(b.id) }, geometry: { type: 'Point', coordinates: [b.lng, b.lat] } };
    });
    m.addSource('bins-src', { type: 'geojson', data: { type: 'FeatureCollection', features: binFeatures } });
    m.addLayer({ id: 'bins-circles', type: 'circle', source: 'bins-src', paint: {
      'circle-radius': 9,
      'circle-color': ['case', ['get', 'isNext'], '#ca8a04', '#059669'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff'
    }});

    if (line && line.length >= 2) {
      var coords = line.map(function(p){ return [p[1], p[0]]; });
      m.addSource('route-src', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
      m.addLayer({ id: 'route-line', type: 'line', source: 'route-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0d9488', 'line-width': 5, 'line-opacity': 0.92 } });
    }

    if (u && u.lat && u.lng) {
      m.addSource('user-src', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [u.lng, u.lat] } } });
      var ur = driverAsStart ? 12 : 10;
      m.addLayer({ id: 'user', type: 'circle', source: 'user-src', paint: { 'circle-radius': ur, 'circle-color': '#2563eb', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
    }

    if (follow && u && u.lat && u.lng) {
      m.easeTo({ center: [u.lng, u.lat], zoom: 17, duration: 0 });
    } else {
      var bb = new mapboxgl.LngLatBounds();
      if (routeStart && routeStart.lat != null) bb.extend([routeStart.lng, routeStart.lat]);
      bins.forEach(function(x){ bb.extend([x.lng, x.lat]); });
      if (u && u.lat) bb.extend([u.lng, u.lat]);
      if (showRef && refDepot && refDepot.lat != null) bb.extend([refDepot.lng, refDepot.lat]);
      if (line && line.length) line.forEach(function(p){ bb.extend([p[1], p[0]]); });
      m.fitBounds(bb, { padding: { top: 44, bottom: 130, left: 28, right: 28 }, maxZoom: 15, duration: 0 });
    }
  } catch(e) {}
  true;
})();
`;
}

export function buildLeafletLayersScript({
  followTruck,
  binsJson,
  lineJson,
  userJson,
  routeStartJson,
  referenceDepotJson,
  driverIsRouteOrigin,
  showReferenceDepot,
}) {
  const follow = followTruck ? "true" : "false";
  const drv = driverIsRouteOrigin ? "true" : "false";
  const showRef = showReferenceDepot ? "true" : "false";
  return `
      try {
        if (typeof map === 'undefined') return;
        if (window._layers) {
          window._layers.forEach(function(l){ try { map.removeLayer(l); } catch(e){} });
        }
        window._layers = [];
        var routeStart = ${routeStartJson};
        var refDepot = ${referenceDepotJson};
        var driverAsStart = ${drv};
        var showRef = ${showRef};

        if (!driverAsStart && routeStart && routeStart.lat != null) {
          var rsIcon = L.divIcon({
            className: 'route-start-x',
            html: '<div style="background:#b45309;width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>',
            iconSize: [22,22], iconAnchor: [11,11]
          });
          var rsm = L.marker([routeStart.lat, routeStart.lng], { icon: rsIcon }).addTo(map);
          rsm.bindPopup('<b>Route start</b><br>SWMO reference');
          window._layers.push(rsm);
        }
        if (showRef && refDepot && refDepot.lat != null) {
          var rfIcon = L.divIcon({
            className: 'ref-depot-x',
            html: '<div style="background:#64748b;width:14px;height:14px;border-radius:50%;border:2px solid #fff;opacity:0.9"></div>',
            iconSize: [14,14], iconAnchor: [7,7]
          });
          var rfm = L.marker([refDepot.lat, refDepot.lng], { icon: rfIcon }).addTo(map);
          rfm.bindPopup('<b>SWMO</b><br>Reference only');
          window._layers.push(rfm);
        }

        var bins = ${binsJson};
        bins.forEach(function(b){
          var col = b.isNext ? '#ca8a04' : '#059669';
          var ic = L.divIcon({
            className: 'bin-m',
            html: '<div style="background:'+col+';width:18px;height:18px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.3)"></div>',
            iconSize: [18,18], iconAnchor: [9,9]
          });
          var mk = L.marker([b.lat, b.lng], { icon: ic }).addTo(map);
          mk.bindPopup('<b>'+b.id+'</b><br>Stop '+(b.idx+1));
          window._layers.push(mk);
        });

        var line = ${lineJson};
        if (line && line.length >= 2) {
          var pl = L.polyline(line, { color: '#0d9488', weight: 5, opacity: 0.92 }).addTo(map);
          window._layers.push(pl);
        }

        var u = ${userJson};
        if (u && u.lat && u.lng) {
          var rad = driverAsStart ? 11 : 9;
          var um = L.circleMarker([u.lat, u.lng], {
            radius: rad, fillColor: '#2563eb', color: '#fff', weight: 2, fillOpacity: 0.95
          }).addTo(map);
          um.bindPopup(driverAsStart ? 'You · route starts here' : 'You are here');
          window._layers.push(um);
        }

        var bounds = [];
        if (routeStart && routeStart.lat != null) bounds.push([routeStart.lat, routeStart.lng]);
        bins.forEach(function(b){ bounds.push([b.lat, b.lng]); });
        if (u && u.lat) bounds.push([u.lat, u.lng]);
        if (showRef && refDepot && refDepot.lat != null) bounds.push([refDepot.lat, refDepot.lng]);
        if (line && line.length) line.forEach(function(c){ bounds.push(c); });
        var follow = ${follow};
        if (follow && u && u.lat && u.lng) {
          map.setView([u.lat, u.lng], 17, { animate: false });
        } else if (bounds.length) {
          map.fitBounds(bounds, { padding: [36,36], maxZoom: 15 });
        }
      } catch(e) {}
      true;
    `;
}
