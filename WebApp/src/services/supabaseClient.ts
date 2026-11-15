import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getValidatedConfig(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (
    typeof url !== "string" ||
    url.trim() === "" ||
    typeof anonKey !== "string" ||
    anonKey.trim() === ""
  ) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith("http")) {
      return null;
    }
  } catch {
    return null;
  }

  return { url: url.trim(), anonKey: anonKey.trim() };
}

const config = getValidatedConfig();

export const isSupabaseConfigured = config !== null;

export const supabaseConfigError: string | null = isSupabaseConfigured
  ? null
  : "EcoLoop web app is not fully configured. Missing or invalid VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables. Please contact your administrator.";

function renderStartupErrorScreen(message: string) {
  if (typeof document === "undefined") return;
  const mount = () => {
    const root = document.getElementById("root");
    if (!root) return;
    root.innerHTML = `
      <div style="min-height: 100vh; background-color: #f9fafb; display: flex; align-items: center; justify-content: center; padding: 1.5rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <div style="max-width: 32rem; width: 100%; border: 1px solid #fecaca; background: #ffffff; padding: 1.5rem; border-radius: 0.75rem; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
          <div style="display: flex; align-items: center; margin-bottom: 0.75rem;">
            <div style="width: 2.5rem; height: 2.5rem; border-radius: 9999px; background-color: #fee2e2; display: flex; align-items: center; justify-content: center; margin-right: 0.75rem; font-weight: bold; color: #dc2626; font-size: 1.25rem;">!</div>
            <h1 style="font-size: 1.25rem; font-weight: 600; color: #b91c1c; margin: 0;">Configuration Required</h1>
          </div>
          <p style="font-size: 0.875rem; color: #374151; line-height: 1.5; margin: 0 0 1rem 0;">
            ${message}
          </p>
          <div style="border-top: 1px solid #f3f4f6; padding-top: 0.75rem; font-size: 0.75rem; color: #6b7280;">
            Please ensure environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) are configured.
          </div>
        </div>
      </div>
    `;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
}

if (!isSupabaseConfigured && supabaseConfigError) {
  renderStartupErrorScreen(supabaseConfigError);
}

function createUnconfiguredProxy(): SupabaseClient {
  return new Proxy({} as SupabaseClient, {
    get(_target, prop: string) {
      if (prop === "auth") {
        return {
          getSession: () => Promise.resolve({ data: { session: null }, error: new Error(supabaseConfigError!) }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
          signOut: () => Promise.resolve({ error: null }),
        };
      }
      return () => {
        throw new Error(supabaseConfigError ?? "Supabase client is not configured.");
      };
    },
  });
}

export const supabase: SupabaseClient = config
  ? createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : createUnconfiguredProxy();

