import { useCallback, useEffect, useState } from "react";
import { Activity, Database, HardDrive, Map as MapIcon, RefreshCw, Server } from "lucide-react";
import { supabase } from "../../services/supabaseClient";
import { formatDateTime } from "../../hooks/useLiveData";
import { isMapboxDirectionsConfigured } from "../../services/streetRouteService";

interface SyncLogSummaryRow {
  sync_status: string;
  created_at: string;
  processed_at: string | null;
}

interface ProbeState {
  checking: boolean;
  checkedAt: string | null;
  dbStatus: "connected" | "error" | "checking";
  dbLatencyMs: number | null;
  dbError: string | null;
  realtimeStatus: string;
  syncPending: number | null;
  syncSynced: number | null;
  syncFailed: number | null;
  syncLastActivity: string | null;
  syncError: string | null;
}

const INITIAL_PROBE: ProbeState = {
  checking: true,
  checkedAt: null,
  dbStatus: "checking",
  dbLatencyMs: null,
  dbError: null,
  realtimeStatus: "Checking…",
  syncPending: null,
  syncSynced: null,
  syncFailed: null,
  syncLastActivity: null,
  syncError: null,
};

const WEBAPP_VERSION = "1.0.0";

/** Displays honest, verified WebApp runtime status, Supabase latency, Realtime state, and Mobile sync logs. */
export default function SystemInfoTab() {
  const [probe, setProbe] = useState<ProbeState>(INITIAL_PROBE);
  const mapboxConfigured = isMapboxDirectionsConfigured();
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Unavailable";
  const browserLocale = typeof navigator !== "undefined" ? navigator.language : "Unavailable";

  const runHealthCheck = useCallback(async () => {
    setProbe((prev) => ({ ...prev, checking: true, dbStatus: "checking", realtimeStatus: "Probing…" }));

    const dbStart = performance.now();
    const dbRes = await supabase.from("system_settings").select("key", { count: "exact", head: true });
    const dbLatencyMs = Math.max(1, Math.round(performance.now() - dbStart));

    const syncRes = await supabase
      .from("mobile_sync_queue_logs")
      .select("sync_status, created_at, processed_at")
      .order("created_at", { ascending: false })
      .limit(200);

    let syncPending: number | null = null;
    let syncSynced: number | null = null;
    let syncFailed: number | null = null;
    let syncLastActivity: string | null = null;
    let syncError: string | null = null;

    if (syncRes.error) {
      syncError = syncRes.error.message;
    } else {
      const rows = (syncRes.data as SyncLogSummaryRow[]) ?? [];
      syncPending = rows.filter((r) => String(r.sync_status).toLowerCase() === "pending").length;
      syncSynced = rows.filter((r) => String(r.sync_status).toLowerCase() === "synced").length;
      syncFailed = rows.filter((r) => String(r.sync_status).toLowerCase() === "failed").length;
      syncLastActivity = rows[0]?.processed_at ?? rows[0]?.created_at ?? null;
    }

    const realtimeStatus = await new Promise<string>((resolve) => {
      let settled = false;
      const channelName = `sysinfo-health-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const channel = supabase.channel(channelName);

      const finish = (status: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        void supabase.removeChannel(channel);
        resolve(status);
      };

      const timer = window.setTimeout(() => finish("TIMED_OUT"), 4000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          finish(status);
        }
      });
    });

    setProbe({
      checking: false,
      checkedAt: new Date().toISOString(),
      dbStatus: dbRes.error ? "error" : "connected",
      dbLatencyMs,
      dbError: dbRes.error?.message ?? null,
      realtimeStatus,
      syncPending,
      syncSynced,
      syncFailed,
      syncLastActivity,
      syncError,
    });
  }, []);

  useEffect(() => {
    void runHealthCheck();
  }, [runHealthCheck]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <Server className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Verified System Diagnostics</h2>
            <p className="mt-1 text-sm text-gray-600">
              Live connectivity probes and runtime metadata only. Unverifiable infrastructure metrics are never
              simulated.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {probe.checkedAt && (
            <span className="text-xs text-gray-500">Last checked: {formatDateTime(probe.checkedAt)}</span>
          )}
          <button
            type="button"
            disabled={probe.checking}
            onClick={() => void runHealthCheck()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${probe.checking ? "animate-spin" : ""}`} aria-hidden="true" />
            <span>Run Health Check</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Application Build & Map Integration */}
        <section aria-labelledby="heading-app-build" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <MapIcon className="size-4 text-emerald-600" aria-hidden="true" />
            <h3 id="heading-app-build">Application &amp; Mapping Runtime</h3>
          </div>
          <dl className="mt-4 divide-y divide-gray-100 text-sm">
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-gray-600">WebApp Package Version</dt>
              <dd className="font-mono font-semibold text-gray-900">v{WEBAPP_VERSION}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-gray-600">Map &amp; Directions Engine</dt>
              <dd>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    mapboxConfigured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {mapboxConfigured ? "Mapbox GL + Directions Configured" : "OSM / OSRM Fallback Active"}
                </span>
              </dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-gray-600">Browser Locale / Timezone</dt>
              <dd className="text-xs font-medium text-gray-800">
                {browserLocale} · {browserTimezone}
              </dd>
            </div>
          </dl>
        </section>

        {/* Live Supabase Connection & Realtime */}
        <section aria-labelledby="heading-supabase-conn" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Database className="size-4 text-emerald-600" aria-hidden="true" />
            <h3 id="heading-supabase-conn">Database &amp; Realtime Service</h3>
          </div>
          <dl className="mt-4 divide-y divide-gray-100 text-sm">
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-gray-600">PostgreSQL REST Connection</dt>
              <dd>
                {probe.dbStatus === "checking" ? (
                  <span className="text-xs font-medium text-gray-500">Checking…</span>
                ) : probe.dbStatus === "connected" ? (
                  <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    Connected ({probe.dbLatencyMs} ms)
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                    Unavailable
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-gray-600">Realtime WebSocket Probe</dt>
              <dd>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    probe.realtimeStatus === "SUBSCRIBED"
                      ? "bg-emerald-50 text-emerald-700"
                      : probe.checking
                        ? "bg-gray-100 text-gray-600"
                        : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {probe.realtimeStatus}
                </span>
              </dd>
            </div>
            {probe.dbError && (
              <div className="py-2 text-xs text-red-600">Database error: {probe.dbError}</div>
            )}
          </dl>
        </section>

        {/* Mobile Offline Sync Queue */}
        <section aria-labelledby="heading-mobile-sync" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Activity className="size-4 text-emerald-600" aria-hidden="true" />
            <h3 id="heading-mobile-sync">Mobile App Synchronization Queue</h3>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Counts from the latest 200 entries in{" "}
            <code className="rounded bg-gray-100 px-1">public.mobile_sync_queue_logs</code>.
          </p>
          {probe.syncError ? (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Unavailable: {probe.syncError}
            </p>
          ) : (
            <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <dt className="text-[11px] font-medium uppercase text-gray-500">Synced</dt>
                <dd className="mt-1 text-lg font-bold text-emerald-700 tabular-nums">
                  {probe.syncSynced ?? "—"}
                </dd>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <dt className="text-[11px] font-medium uppercase text-gray-500">Pending</dt>
                <dd className="mt-1 text-lg font-bold text-amber-700 tabular-nums">
                  {probe.syncPending ?? "—"}
                </dd>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <dt className="text-[11px] font-medium uppercase text-gray-500">Failed</dt>
                <dd className="mt-1 text-lg font-bold text-red-700 tabular-nums">
                  {probe.syncFailed ?? "—"}
                </dd>
              </div>
            </dl>
          )}
          <div className="mt-3 text-xs text-gray-500">
            Latest recorded sync activity:{" "}
            <span className="font-medium text-gray-800">
              {probe.syncLastActivity ? formatDateTime(probe.syncLastActivity) : "Not recorded"}
            </span>
          </div>
        </section>

        {/* Honest Cloud Backup Notice */}
        <section aria-labelledby="heading-backups" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <HardDrive className="size-4 text-gray-600" aria-hidden="true" />
            <h3 id="heading-backups">Database Backups &amp; Recovery</h3>
          </div>
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="inline-flex rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-800">
              Managed in Supabase Cloud — unavailable from client SDK
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-gray-600">
              Scheduled snapshots and point-in-time recovery status live in the Supabase Cloud project control
              plane and cannot be verified through the browser client key. Check Supabase Dashboard → Database → Backups
              for exact snapshot timestamps.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
