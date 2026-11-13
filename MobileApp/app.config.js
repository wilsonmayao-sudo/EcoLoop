const path = require('path');
const fs = require('fs');
const appJson = require('./app.json');

/** Read KEY=value from a .env-style file (no multiline values). */
function readEnvValueFromFile(filePath, key) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n|\r/);
    for (const line of lines) {
      const trimmed = line.replace(/\r/g, '').trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const k = trimmed.slice(0, eq).trim();
      if (k !== key) continue;
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v;
    }
  } catch {
    /* ignore */
  }
  return '';
}

module.exports = ({ config }) => {
  const baseExpo = appJson.expo ?? {};
  const baseExtra = { ...(config.extra || {}), ...(baseExpo.extra || {}) };
  const pluginName = (entry) => (Array.isArray(entry) ? entry[0] : entry);
  const rawPlugins = [...(config.plugins ?? []), ...(baseExpo.plugins ?? []), 'expo-notifications'];
  const seenPlugins = new Set();
  const plugins = [];
  for (const entry of rawPlugins) {
    const name = pluginName(entry);
    if (!name || seenPlugins.has(name)) continue;
    seenPlugins.add(name);
    plugins.push(entry);
  }

  /**
   * Mapbox public token (pk.*). If the map is blank in the app but overlays work, the token may have
   * **URL restrictions** that only allow your web dev URL — Expo WebView requests often have no / wrong Referer.
   * Fix: use a separate public token with no URL restrictions for MobileApp, or remove restrictions on this token.
   */
  const mapboxAccessToken =
    process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ||
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.VITE_MAPBOX_ACCESS_TOKEN ||
    readEnvValueFromFile(mobileEnv, 'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN') ||
    readEnvValueFromFile(mobileEnvLocal, 'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN') ||
    readEnvValueFromFile(mobileEnv, 'MAPBOX_ACCESS_TOKEN') ||
    readEnvValueFromFile(mobileEnvLocal, 'MAPBOX_ACCESS_TOKEN') ||
    readEnvValueFromFile(mobileEnv, 'VITE_MAPBOX_ACCESS_TOKEN') ||
    readEnvValueFromFile(mobileEnvLocal, 'VITE_MAPBOX_ACCESS_TOKEN') ||
    readEnvValueFromFile(webEnvLocal, 'VITE_MAPBOX_ACCESS_TOKEN') ||
    readEnvValueFromFile(webEnvLocal, 'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN') ||
    (typeof baseExtra.mapboxAccessToken === 'string' ? baseExtra.mapboxAccessToken : '') ||
    '';

  return {
    ...config,
    ...baseExpo,
    plugins,
    extra: {
      ...baseExtra,
      mapboxAccessToken,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || readEnvValueFromFile(mobileEnv, 'EXPO_PUBLIC_SUPABASE_URL') || readEnvValueFromFile(mobileEnvLocal, 'EXPO_PUBLIC_SUPABASE_URL') || readEnvValueFromFile(webEnvLocal, 'VITE_SUPABASE_URL') || baseExtra.supabaseUrl || '',
      supabaseAnonKey:
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
        readEnvValueFromFile(mobileEnv, 'EXPO_PUBLIC_SUPABASE_ANON_KEY') ||
        readEnvValueFromFile(mobileEnvLocal, 'EXPO_PUBLIC_SUPABASE_ANON_KEY') ||
        readEnvValueFromFile(webEnvLocal, 'VITE_SUPABASE_ANON_KEY') ||
        baseExtra.supabaseAnonKey ||
        '',
    },
  };
};
