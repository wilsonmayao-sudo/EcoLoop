import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Info,
  ListFilter,
  Map as MapIcon,
  RotateCcw,
  Save,
  Shield,
  Sliders,
} from "lucide-react";
import ConfirmModal from "../components/feedback/ConfirmModal";
import Toast from "../components/feedback/Toast";
import PageHeader from "../components/layout/PageHeader";
import ReferenceListsTab from "../components/settings/ReferenceListsTab";
import SecurityAuditTab from "../components/settings/SecurityAuditTab";
import SystemInfoTab from "../components/settings/SystemInfoTab";
import CustomSelect from "../components/ui/CustomSelect";
import { useAuth } from "../contexts/AuthContext";
import { useLiveData, type PageType, type ReferenceTableName } from "../hooks/useLiveData";
import {
  DEFAULT_DEPOT_SETTING,
  DEFAULT_DISPLAY_PREFERENCES,
  DEFAULT_LANDFILL_SETTING,
  DEFAULT_MAP_DEFAULTS,
  DEFAULT_OPERATIONS_CONFIG,
  DEFAULT_ORGANIZATION_SETTING,
  DEFAULT_SECURITY_CONFIG,
  formatDateTime,
  formatDistanceDisplay,
  formatMassDisplay,
  formatVolumeDisplay,
  MAPBOX_STYLE_OPTIONS,
  normalizeDepotSetting,
  normalizeDisplayPreferences,
  normalizeLandfillSetting,
  normalizeMapDefaults,
  normalizeOperationsConfig,
  normalizeOrganizationSetting,
  normalizeSecurityConfig,
  SYSTEM_SETTING_DESCRIPTIONS,
  SYSTEM_SETTING_KEYS,
  TIMEZONE_OPTIONS,
  validateGeneralDraft,
  validateMapDefaultsDraft,
  validateOperationsDraft,
  validateSecurityDraft,
  type DateFormatOption,
  type DepotSetting,
  type DisplayPreferencesSetting,
  type DistanceUnitOption,
  type LandfillSetting,
  type MapboxStyleId,
  type MapDefaultsSetting,
  type MassUnitOption,
  type OperationsConfigSetting,
  type OrganizationSetting,
  type SecurityConfigSetting,
  type SettingFieldErrors,
  type TimeFormatOption,
  type VolumeUnitOption,
} from "../utils/systemSettings";

interface SystemSettingsProps {
  onNavigate?: (page: PageType) => void;
}

type SettingsTabId = "general" | "operations" | "map" | "lists" | "security" | "info";
type EditableSettingsTabId = "general" | "operations" | "map" | "security";

interface TabDefinition {
  id: SettingsTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabDefinition[] = [
  { id: "general", label: "General", icon: Building2 },
  { id: "operations", label: "Operations", icon: Sliders },
  { id: "map", label: "Map Defaults", icon: MapIcon },
  { id: "lists", label: "Reference Lists", icon: ListFilter },
  { id: "security", label: "Security & Audit", icon: Shield },
  { id: "info", label: "System Info", icon: Info },
];

const FIELD_INPUT_IDS: Record<string, string> = {
  "organization.name": "org-name",
  "organization.city": "org-city",
  "organization.systemTitle": "org-title",
  "display.timezone": "display-timezone",
  "depot.name": "depot-name",
  "depot.latitude": "depot-lat",
  "depot.longitude": "depot-lng",
  "landfill.name": "landfill-name",
  "landfill.address": "landfill-address",
  "landfill.latitude": "landfill-lat",
  "landfill.longitude": "landfill-lng",
  "landfill.google_maps_url": "landfill-url",
  "ops.operatingHoursStart": "ops-hours-start",
  "ops.operatingHoursEnd": "ops-hours-end",
  "ops.gpsDelayedSeconds": "ops-gps-delayed",
  "ops.gpsStoppedSeconds": "ops-gps-stopped",
  "ops.driverOfflineSeconds": "ops-driver-offline",
  "ops.landfillProximityMeters": "ops-landfill-radius",
  "ops.stopHandlingMinutes": "ops-stop-minutes",
  "map.centerLatitude": "map-center-lat",
  "map.centerLongitude": "map-center-lng",
  "map.defaultZoom": "map-default-zoom",
  "security.minPasswordLength": "security-min-password",
};

function isEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Centralized WebApp Admin System Settings page. */
export default function SystemSettings({ onNavigate }: SystemSettingsProps) {
  const { profile } = useAuth();
  const {
    loading,
    organizationSetting,
    displayPreferences,
    depotSetting,
    landfillSetting,
    operationsConfig,
    mapDefaults,
    securityConfig,
    rolePermissions,
    allReportCategories,
    allMaintenanceTypes,
    allBinTypes,
    upsertSystemSettingsBatch,
    createReferenceItem,
    updateReferenceItem,
  } = useLiveData();

  const isAdmin = profile?.role === "admin";
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Independent draft copies synced from persisted settings when untouched
  const [orgDraft, setOrgDraft] = useState<OrganizationSetting>(organizationSetting);
  const [displayDraft, setDisplayDraft] = useState<DisplayPreferencesSetting>(displayPreferences);
  const [depotDraft, setDepotDraft] = useState<DepotSetting>(depotSetting);
  const [landfillDraft, setLandfillDraft] = useState<LandfillSetting>(landfillSetting);
  const [opsDraft, setOpsDraft] = useState<OperationsConfigSetting>(operationsConfig);
  const [mapDraft, setMapDraft] = useState<MapDefaultsSetting>(mapDefaults);
  const [securityDraft, setSecurityDraft] = useState<SecurityConfigSetting>(securityConfig);

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [savingTab, setSavingTab] = useState<EditableSettingsTabId | null>(null);
  const [pendingConfirmTab, setPendingConfirmTab] = useState<EditableSettingsTabId | null>(null);
  const [toast, setToast] = useState<{ open: boolean; message: string; type: "success" | "error" | "warning" | "info" }>({
    open: false,
    message: "",
    type: "success",
  });
  const [validationBanner, setValidationBanner] = useState<string | null>(null);

  const generalDirty = useMemo(
    () => !isEqualJson(orgDraft, organizationSetting) || !isEqualJson(displayDraft, displayPreferences),
    [displayDraft, displayPreferences, orgDraft, organizationSetting],
  );
  const operationsDirty = useMemo(
    () =>
      !isEqualJson(depotDraft, depotSetting) ||
      !isEqualJson(landfillDraft, landfillSetting) ||
      !isEqualJson(opsDraft, operationsConfig),
    [depotDraft, depotSetting, landfillDraft, landfillSetting, opsDraft, operationsConfig],
  );
  const mapDirty = useMemo(() => !isEqualJson(mapDraft, mapDefaults), [mapDraft, mapDefaults]);
  const securityDirty = useMemo(() => !isEqualJson(securityDraft, securityConfig), [securityConfig, securityDraft]);

  const prevPersistedRef = useRef({
    org: organizationSetting,
    display: displayPreferences,
    depot: depotSetting,
    landfill: landfillSetting,
    ops: operationsConfig,
    map: mapDefaults,
    security: securityConfig,
  });

  // Synchronize clean sections when Supabase finishes loading without clobbering unsaved edits
  useEffect(() => {
    const prev = prevPersistedRef.current;
    const prevOrg = prev.org;
    const prevDisplay = prev.display;
    prev.org = organizationSetting;
    prev.display = displayPreferences;

    setOrgDraft((current) => (isEqualJson(current, prevOrg) ? organizationSetting : current));
    setDisplayDraft((current) => (isEqualJson(current, prevDisplay) ? displayPreferences : current));
  }, [displayPreferences, organizationSetting]);

  useEffect(() => {
    const prev = prevPersistedRef.current;
    const prevDepot = prev.depot;
    const prevLandfill = prev.landfill;
    const prevOps = prev.ops;
    prev.depot = depotSetting;
    prev.landfill = landfillSetting;
    prev.ops = operationsConfig;

    setDepotDraft((current) => (isEqualJson(current, prevDepot) ? depotSetting : current));
    setLandfillDraft((current) => (isEqualJson(current, prevLandfill) ? landfillSetting : current));
    setOpsDraft((current) => (isEqualJson(current, prevOps) ? operationsConfig : current));
  }, [depotSetting, landfillSetting, operationsConfig]);

  useEffect(() => {
    const prevMap = prevPersistedRef.current.map;
    prevPersistedRef.current.map = mapDefaults;
    setMapDraft((current) => (isEqualJson(current, prevMap) ? mapDefaults : current));
  }, [mapDefaults]);

  useEffect(() => {
    const prevSecurity = prevPersistedRef.current.security;
    prevPersistedRef.current.security = securityConfig;
    setSecurityDraft((current) => (isEqualJson(current, prevSecurity) ? securityConfig : current));
  }, [securityConfig]);

  const dirtyByTab: Record<SettingsTabId, boolean> = useMemo(
    () => ({
      general: generalDirty,
      operations: operationsDirty,
      map: mapDirty,
      lists: false,
      security: securityDirty,
      info: false,
    }),
    [generalDirty, mapDirty, operationsDirty, securityDirty],
  );

  const hasAnyUnsavedChanges = generalDirty || operationsDirty || mapDirty || securityDirty;

  useEffect(() => {
    if (!hasAnyUnsavedChanges) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasAnyUnsavedChanges]);

  const generalErrors = useMemo(() => validateGeneralDraft(orgDraft, displayDraft), [displayDraft, orgDraft]);
  const operationsErrors = useMemo(
    () => validateOperationsDraft(depotDraft, landfillDraft, opsDraft),
    [depotDraft, landfillDraft, opsDraft],
  );
  const mapErrors = useMemo(() => validateMapDefaultsDraft(mapDraft), [mapDraft]);
  const securityErrors = useMemo(() => validateSecurityDraft(securityDraft), [securityDraft]);

  const markFieldTouched = (fieldKey: string) => {
    setTouched((prev) => ({ ...prev, [fieldKey]: true }));
  };

  const getErrorsForTab = (tab: EditableSettingsTabId): SettingFieldErrors => {
    switch (tab) {
      case "general":
        return generalErrors;
      case "operations":
        return operationsErrors;
      case "map":
        return mapErrors;
      case "security":
        return securityErrors;
    }
  };

  const focusFirstError = (errors: SettingFieldErrors) => {
    const firstKey = Object.keys(errors)[0];
    if (!firstKey) return;
    const inputId = FIELD_INPUT_IDS[firstKey];
    if (!inputId) return;
    const el = document.getElementById(inputId);
    if (el) {
      el.focus();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const persistTab = async (tab: EditableSettingsTabId) => {
    setSavingTab(tab);
    setValidationBanner(null);
    try {
      if (tab === "general") {
        const canonicalOrg = normalizeOrganizationSetting(orgDraft);
        const canonicalDisplay = normalizeDisplayPreferences(displayDraft);
        await upsertSystemSettingsBatch([
          {
            key: SYSTEM_SETTING_KEYS.ORGANIZATION,
            value: canonicalOrg,
            description: SYSTEM_SETTING_DESCRIPTIONS.organization,
          },
          {
            key: SYSTEM_SETTING_KEYS.DISPLAY_PREFERENCES,
            value: canonicalDisplay,
            description: SYSTEM_SETTING_DESCRIPTIONS.display_preferences,
          },
        ]);
        setOrgDraft(canonicalOrg);
        setDisplayDraft(canonicalDisplay);
      } else if (tab === "operations") {
        const canonicalDepot = normalizeDepotSetting(depotDraft);
        const canonicalLandfill = normalizeLandfillSetting(landfillDraft);
        const canonicalOps = normalizeOperationsConfig(opsDraft);
        await upsertSystemSettingsBatch([
          {
            key: SYSTEM_SETTING_KEYS.DEPOT,
            value: canonicalDepot,
            description: SYSTEM_SETTING_DESCRIPTIONS.depot,
          },
          {
            key: SYSTEM_SETTING_KEYS.LANDFILL,
            value: canonicalLandfill,
            description: SYSTEM_SETTING_DESCRIPTIONS.landfill,
          },
          {
            key: SYSTEM_SETTING_KEYS.OPERATIONS_CONFIG,
            value: canonicalOps,
            description: SYSTEM_SETTING_DESCRIPTIONS.operations_config,
          },
        ]);
        setDepotDraft(canonicalDepot);
        setLandfillDraft(canonicalLandfill);
        setOpsDraft(canonicalOps);
      } else if (tab === "map") {
        const canonicalMap = normalizeMapDefaults(mapDraft);
        await upsertSystemSettingsBatch([
          {
            key: SYSTEM_SETTING_KEYS.MAP_DEFAULTS,
            value: canonicalMap,
            description: SYSTEM_SETTING_DESCRIPTIONS.map_defaults,
          },
        ]);
        setMapDraft(canonicalMap);
      } else if (tab === "security") {
        const canonicalSecurity = normalizeSecurityConfig(securityDraft);
        await upsertSystemSettingsBatch([
          {
            key: SYSTEM_SETTING_KEYS.SECURITY_CONFIG,
            value: canonicalSecurity,
            description: SYSTEM_SETTING_DESCRIPTIONS.security_config,
          },
        ]);
        setSecurityDraft(canonicalSecurity);
      }

      setToast({ open: true, type: "success", message: "Settings saved and logged to system audit trail." });
    } catch (err: any) {
      setToast({ open: true, type: "error", message: err?.message ?? "Failed to save settings." });
    } finally {
      setSavingTab(null);
      setPendingConfirmTab(null);
    }
  };

  const requestSaveTab = (tab: EditableSettingsTabId) => {
    if (!isAdmin) return;
    const errors = getErrorsForTab(tab);
    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      setTouched((prev) => {
        const next = { ...prev };
        Object.keys(FIELD_INPUT_IDS).forEach((k) => {
          next[k] = true;
        });
        return next;
      });
      setValidationBanner(`Fix ${errorKeys.length} validation ${errorKeys.length === 1 ? "issue" : "issues"} before saving.`);
      focusFirstError(errors);
      return;
    }
    setValidationBanner(null);

    if (tab === "general") {
      void persistTab("general");
      return;
    }
    setPendingConfirmTab(tab);
  };

  const handleDiscardTab = (tab: EditableSettingsTabId) => {
    setValidationBanner(null);
    if (tab === "general") {
      setOrgDraft(organizationSetting);
      setDisplayDraft(displayPreferences);
    } else if (tab === "operations") {
      setDepotDraft(depotSetting);
      setLandfillDraft(landfillSetting);
      setOpsDraft(operationsConfig);
    } else if (tab === "map") {
      setMapDraft(mapDefaults);
    } else if (tab === "security") {
      setSecurityDraft(securityConfig);
    }
  };

  const handleRestoreDefaultsTab = (tab: EditableSettingsTabId) => {
    setValidationBanner(null);
    if (tab === "general") {
      setOrgDraft(DEFAULT_ORGANIZATION_SETTING);
      setDisplayDraft(DEFAULT_DISPLAY_PREFERENCES);
    } else if (tab === "operations") {
      setDepotDraft(DEFAULT_DEPOT_SETTING);
      setLandfillDraft(DEFAULT_LANDFILL_SETTING);
      setOpsDraft(DEFAULT_OPERATIONS_CONFIG);
    } else if (tab === "map") {
      setMapDraft(DEFAULT_MAP_DEFAULTS);
    } else if (tab === "security") {
      setSecurityDraft(DEFAULT_SECURITY_CONFIG);
    }
  };

  const selectTab = (nextTab: SettingsTabId) => {
    setValidationBanner(null);
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let targetIndex = currentIndex;
    if (event.key === "ArrowRight") {
      targetIndex = (currentIndex + 1) % TABS.length;
    } else if (event.key === "ArrowLeft") {
      targetIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = TABS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const targetTab = TABS[targetIndex];
    selectTab(targetTab.id);
    tabRefs.current[targetTab.id]?.focus();
  };

  const renderFieldError = (fieldKey: string, errors: SettingFieldErrors) => {
    if (!touched[fieldKey] || !errors[fieldKey]) return null;
    return (
      <p id={`error-${fieldKey}`} className="text-xs font-medium text-red-600">
        {errors[fieldKey]}
      </p>
    );
  };

  const confirmModalCopy = useMemo(() => {
    if (pendingConfirmTab === "operations") {
      return {
        title: "Save Operations & Telemetry Settings?",
        message:
          "Updating depot coordinates, landfill geofence radius, or GPS staleness intervals immediately affects Route Planning estimates and Live Monitoring truck statuses.",
        variant: "warning" as const,
      };
    }
    if (pendingConfirmTab === "map") {
      return {
        title: "Save Map Default Preferences?",
        message:
          "Updating the default Mapbox style, viewport center, zoom level, or facility marker visibility updates map views across the WebApp.",
        variant: "info" as const,
      };
    }
    if (pendingConfirmTab === "security") {
      return {
        title: "Apply Security & Session Policy?",
        message:
          "Changes to idle session timeout and minimum password length apply immediately to active web sessions and staff account creation.",
        variant: "warning" as const,
      };
    }
    return null;
  }, [pendingConfirmTab]);

  const activeEditableTab: EditableSettingsTabId | null =
    activeTab === "general" || activeTab === "operations" || activeTab === "map" || activeTab === "security"
      ? activeTab
      : null;

  const activeTabLabel = TABS.find((t) => t.id === activeTab)?.label ?? "Settings";

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="System Settings"
        description="Manage organization profile, display units, collection rules, map defaults, reference lists, security policy, and diagnostics."
        onNavigate={onNavigate}
        badge={
          hasAnyUnsavedChanges ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
              <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
              Unsaved edits
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Synced
            </span>
          )
        }
      />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {!isAdmin && (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Read-only preview: Only Administrator accounts may modify persisted system settings.
          </div>
        )}

        {/* Single-row non-wrapping accessible tablist with bottom-border indicator */}
        <div className="border-b border-gray-200 bg-white rounded-t-xl px-2 sm:px-4">
          <div
            role="tablist"
            aria-label="System Settings Sections"
            className="flex flex-nowrap items-center gap-1 overflow-x-auto"
          >
            {TABS.map((tab, index) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              const isDirty = dirtyByTab[tab.id];
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[tab.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`settings-tab-${tab.id}`}
                  aria-selected={isSelected}
                  aria-controls={`settings-panel-${tab.id}`}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, index)}
                  className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-inset ${
                    isSelected
                      ? "border-emerald-600 bg-emerald-50/40 font-semibold text-emerald-800"
                      : "border-transparent font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  <Icon className={`size-4 ${isSelected ? "text-emerald-700" : "text-gray-400"}`} aria-hidden="true" />
                  <span>{tab.label}</span>
                  {isDirty && (
                    <span
                      className="size-2 rounded-full bg-amber-500"
                      title="Unsaved changes"
                      aria-label="(has unsaved changes)"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sticky Unsaved Banner & Validation Alert */}
        {activeEditableTab && dirtyByTab[activeEditableTab] && (
          <div
            role="region"
            aria-label="Pending changes"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-xs"
          >
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
              <span>You have unsaved changes in {activeTabLabel}.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleDiscardTab(activeEditableTab)}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                Cancel &amp; Discard
              </button>
              {isAdmin && (
                <button
                  type="button"
                  disabled={savingTab === activeEditableTab}
                  onClick={() => requestSaveTab(activeEditableTab)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Save className="size-3.5" aria-hidden="true" />
                  <span>{savingTab === activeEditableTab ? "Saving…" : "Save Changes"}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {validationBanner && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {validationBanner}
          </div>
        )}

        {/* Active Tab Panel */}
        <div
          role="tabpanel"
          id={`settings-panel-${activeTab}`}
          aria-labelledby={`settings-tab-${activeTab}`}
          tabIndex={0}
          className="focus:outline-none"
        >
          {loading && !hasAnyUnsavedChanges ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
              Loading system settings…
            </div>
          ) : (
            <>
              {activeTab === "general" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <section aria-labelledby="heading-org" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
                      <h2 id="heading-org" className="text-base font-semibold text-gray-900">
                        Organization &amp; Branding
                      </h2>
                      <p className="mt-1 text-sm text-gray-600">
                        Displayed in the dashboard sidebar, browser title bar, and supervisor PDF exports.
                      </p>

                      <div className="mt-5 space-y-5">
                        <div className="space-y-1">
                          <label htmlFor="org-name" className="block text-sm font-medium text-gray-800">
                            Organization Name
                          </label>
                          <p id="hint-org-name" className="text-xs text-gray-500">
                            Official department name printed on exported operational reports.
                          </p>
                          <input
                            id="org-name"
                            type="text"
                            disabled={!isAdmin}
                            value={orgDraft.name}
                            aria-describedby="hint-org-name"
                            aria-invalid={Boolean(touched["organization.name"] && generalErrors["organization.name"])}
                            onChange={(e) => setOrgDraft((p) => ({ ...p, name: e.target.value }))}
                            onBlur={() => markFieldTouched("organization.name")}
                            className="input-field"
                          />
                          {renderFieldError("organization.name", generalErrors)}
                        </div>

                        <div className="space-y-1">
                          <label htmlFor="org-city" className="block text-sm font-medium text-gray-800">
                            City / Municipality
                          </label>
                          <p id="hint-org-city" className="text-xs text-gray-500">
                            Shown below the primary logo in the left navigation rail.
                          </p>
                          <input
                            id="org-city"
                            type="text"
                            disabled={!isAdmin}
                            value={orgDraft.city}
                            aria-describedby="hint-org-city"
                            aria-invalid={Boolean(touched["organization.city"] && generalErrors["organization.city"])}
                            onChange={(e) => setOrgDraft((p) => ({ ...p, city: e.target.value }))}
                            onBlur={() => markFieldTouched("organization.city")}
                            className="input-field"
                          />
                          {renderFieldError("organization.city", generalErrors)}
                        </div>

                        <div className="space-y-1">
                          <label htmlFor="org-title" className="block text-sm font-medium text-gray-800">
                            Dashboard Title
                          </label>
                          <p id="hint-org-title" className="text-xs text-gray-500">
                            Sets the browser tab title and sidebar application heading.
                          </p>
                          <input
                            id="org-title"
                            type="text"
                            disabled={!isAdmin}
                            value={orgDraft.systemTitle}
                            aria-describedby="hint-org-title"
                            aria-invalid={Boolean(
                              touched["organization.systemTitle"] && generalErrors["organization.systemTitle"],
                            )}
                            onChange={(e) => setOrgDraft((p) => ({ ...p, systemTitle: e.target.value }))}
                            onBlur={() => markFieldTouched("organization.systemTitle")}
                            className="input-field"
                          />
                          {renderFieldError("organization.systemTitle", generalErrors)}
                        </div>

                        <div className="space-y-1">
                          <label htmlFor="org-support" className="block text-sm font-medium text-gray-800">
                            Operations Support Contact (Optional)
                          </label>
                          <p id="hint-org-support" className="text-xs text-gray-500">
                            Dispatch desk phone number or email for staff reference.
                          </p>
                          <input
                            id="org-support"
                            type="text"
                            disabled={!isAdmin}
                            placeholder="e.g. dispatch@nagacity.gov.ph"
                            value={orgDraft.supportContact}
                            aria-describedby="hint-org-support"
                            onChange={(e) => setOrgDraft((p) => ({ ...p, supportContact: e.target.value }))}
                            className="input-field"
                          />
                        </div>
                      </div>
                    </section>

                    <section aria-labelledby="heading-display" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
                      <h2 id="heading-display" className="text-base font-semibold text-gray-900">
                        Date, Time &amp; Measurement Units
                      </h2>
                      <p className="mt-1 text-sm text-gray-600">
                        Applies consistently across Live Monitoring, Route Planning, Fleet Maintenance, and PDF exports.
                      </p>

                      <div className="mt-5 space-y-5">
                        <div className="space-y-1">
                          <label htmlFor="display-timezone" className="block text-sm font-medium text-gray-800">
                            Display Timezone
                          </label>
                          <p id="hint-display-timezone" className="text-xs text-gray-500">
                            Used to format event, report, and dispatch timestamps.
                          </p>
                          <CustomSelect
                            id="display-timezone"
                            disabled={!isAdmin}
                            value={displayDraft.timezone}
                            ariaLabel="Display timezone"
                            options={TIMEZONE_OPTIONS}
                            onChange={(val) => setDisplayDraft((p) => ({ ...p, timezone: val }))}
                          />
                          {renderFieldError("display.timezone", generalErrors)}
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-1">
                            <label htmlFor="display-date-fmt" className="block text-sm font-medium text-gray-800">
                              Date Format
                            </label>
                            <CustomSelect
                              id="display-date-fmt"
                              disabled={!isAdmin}
                              value={displayDraft.dateFormat}
                              ariaLabel="Date format"
                              options={[
                                { value: "medium", label: "Medium (Nov 14, 2026)" },
                                { value: "short", label: "Short (11/14/26)" },
                                { value: "iso", label: "ISO (2026-11-14)" },
                              ]}
                              onChange={(val) =>
                                setDisplayDraft((p) => ({ ...p, dateFormat: val as DateFormatOption }))
                              }
                            />
                          </div>

                          <div className="space-y-1">
                            <label htmlFor="display-time-fmt" className="block text-sm font-medium text-gray-800">
                              Clock Format
                            </label>
                            <CustomSelect
                              id="display-time-fmt"
                              disabled={!isAdmin}
                              value={displayDraft.timeFormat}
                              ariaLabel="Clock format"
                              options={[
                                { value: "12h", label: "12-hour (AM/PM)" },
                                { value: "24h", label: "24-hour" },
                              ]}
                              onChange={(val) =>
                                setDisplayDraft((p) => ({ ...p, timeFormat: val as TimeFormatOption }))
                              }
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                          <div className="space-y-1">
                            <label htmlFor="display-dist" className="block text-sm font-medium text-gray-800">
                              Distance Unit
                            </label>
                            <CustomSelect
                              id="display-dist"
                              disabled={!isAdmin}
                              value={displayDraft.distanceUnit}
                              ariaLabel="Distance unit"
                              options={[
                                { value: "km", label: "Kilometers (km)" },
                                { value: "m", label: "Meters (m)" },
                              ]}
                              onChange={(val) =>
                                setDisplayDraft((p) => ({ ...p, distanceUnit: val as DistanceUnitOption }))
                              }
                            />
                          </div>

                          <div className="space-y-1">
                            <label htmlFor="display-vol" className="block text-sm font-medium text-gray-800">
                              Volume Unit
                            </label>
                            <CustomSelect
                              id="display-vol"
                              disabled={!isAdmin}
                              value={displayDraft.volumeUnit}
                              ariaLabel="Volume unit"
                              options={[
                                { value: "m3", label: "Cubic Meters (m³)" },
                                { value: "L", label: "Liters (L)" },
                              ]}
                              onChange={(val) =>
                                setDisplayDraft((p) => ({ ...p, volumeUnit: val as VolumeUnitOption }))
                              }
                            />
                          </div>

                          <div className="space-y-1">
                            <label htmlFor="display-mass" className="block text-sm font-medium text-gray-800">
                              Mass Unit
                            </label>
                            <CustomSelect
                              id="display-mass"
                              disabled={!isAdmin}
                              value={displayDraft.massUnit}
                              ariaLabel="Mass unit"
                              options={[
                                { value: "kg", label: "Kilograms (kg)" },
                                { value: "t", label: "Metric Tons (t)" },
                              ]}
                              onChange={(val) =>
                                setDisplayDraft((p) => ({ ...p, massUnit: val as MassUnitOption }))
                              }
                            />
                          </div>
                        </div>

                        {/* Live Preview Box */}
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Live Formatting Preview
                          </div>
                          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-700 sm:grid-cols-4">
                            <div>
                              <dt className="text-gray-500">Timestamp</dt>
                              <dd className="font-semibold text-gray-900">
                                {formatDateTime(new Date().toISOString(), displayDraft)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-gray-500">Route (4.2 km)</dt>
                              <dd className="font-semibold text-gray-900">
                                {formatDistanceDisplay(4200, displayDraft)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-gray-500">Truck Vol (6,000 L)</dt>
                              <dd className="font-semibold text-gray-900">
                                {formatVolumeDisplay(6000, displayDraft)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-gray-500">Payload (3,500 kg)</dt>
                              <dd className="font-semibold text-gray-900">
                                {formatMassDisplay(3500, displayDraft)}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              )}

              {activeTab === "operations" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {/* Depot & Landfill */}
                    <section aria-labelledby="heading-facilities" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
                      <h2 id="heading-facilities" className="text-base font-semibold text-gray-900">
                        Dispatch Depot &amp; Disposal Site Coordinates
                      </h2>
                      <p className="mt-1 text-sm text-gray-600">
                        Used as origin/destination anchors in Route Planning, Dynamic Overflow Reassignment, and Live
                        Monitoring geofencing.
                      </p>

                      <div className="mt-5 space-y-5">
                        <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-4 space-y-4">
                          <h3 className="text-sm font-semibold text-gray-900">Primary Dispatch Depot</h3>
                          <div className="space-y-1">
                            <label htmlFor="depot-name" className="block text-sm font-medium text-gray-800">
                              Depot Name
                            </label>
                            <input
                              id="depot-name"
                              type="text"
                              disabled={!isAdmin}
                              value={depotDraft.name}
                              aria-invalid={Boolean(touched["depot.name"] && operationsErrors["depot.name"])}
                              onChange={(e) => setDepotDraft((p) => ({ ...p, name: e.target.value }))}
                              onBlur={() => markFieldTouched("depot.name")}
                              className="input-field"
                            />
                            {renderFieldError("depot.name", operationsErrors)}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label htmlFor="depot-lat" className="block text-sm font-medium text-gray-800">
                                Latitude
                              </label>
                              <input
                                id="depot-lat"
                                type="number"
                                step="any"
                                disabled={!isAdmin}
                                value={depotDraft.latitude}
                                aria-invalid={Boolean(touched["depot.latitude"] && operationsErrors["depot.latitude"])}
                                onChange={(e) => setDepotDraft((p) => ({ ...p, latitude: Number(e.target.value) }))}
                                onBlur={() => markFieldTouched("depot.latitude")}
                                className="input-field"
                              />
                              {renderFieldError("depot.latitude", operationsErrors)}
                            </div>
                            <div className="space-y-1">
                              <label htmlFor="depot-lng" className="block text-sm font-medium text-gray-800">
                                Longitude
                              </label>
                              <input
                                id="depot-lng"
                                type="number"
                                step="any"
                                disabled={!isAdmin}
                                value={depotDraft.longitude}
                                aria-invalid={Boolean(
                                  touched["depot.longitude"] && operationsErrors["depot.longitude"],
                                )}
                                onChange={(e) => setDepotDraft((p) => ({ ...p, longitude: Number(e.target.value) }))}
                                onBlur={() => markFieldTouched("depot.longitude")}
                                className="input-field"
                              />
                              {renderFieldError("depot.longitude", operationsErrors)}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-4 space-y-4">
                          <h3 className="text-sm font-semibold text-gray-900">Sanitary Landfill Disposal Site</h3>
                          <div className="space-y-1">
                            <label htmlFor="landfill-name" className="block text-sm font-medium text-gray-800">
                              Facility Name
                            </label>
                            <input
                              id="landfill-name"
                              type="text"
                              disabled={!isAdmin}
                              value={landfillDraft.name}
                              aria-invalid={Boolean(touched["landfill.name"] && operationsErrors["landfill.name"])}
                              onChange={(e) => setLandfillDraft((p) => ({ ...p, name: e.target.value }))}
                              onBlur={() => markFieldTouched("landfill.name")}
                              className="input-field"
                            />
                            {renderFieldError("landfill.name", operationsErrors)}
                          </div>
                          <div className="space-y-1">
                            <label htmlFor="landfill-address" className="block text-sm font-medium text-gray-800">
                              Location / Barangay Address
                            </label>
                            <input
                              id="landfill-address"
                              type="text"
                              disabled={!isAdmin}
                              value={landfillDraft.address}
                              aria-invalid={Boolean(
                                touched["landfill.address"] && operationsErrors["landfill.address"],
                              )}
                              onChange={(e) => setLandfillDraft((p) => ({ ...p, address: e.target.value }))}
                              onBlur={() => markFieldTouched("landfill.address")}
                              className="input-field"
                            />
                            {renderFieldError("landfill.address", operationsErrors)}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label htmlFor="landfill-lat" className="block text-sm font-medium text-gray-800">
                                Latitude
                              </label>
                              <input
                                id="landfill-lat"
                                type="number"
                                step="any"
                                disabled={!isAdmin}
                                value={landfillDraft.latitude}
                                aria-invalid={Boolean(
                                  touched["landfill.latitude"] && operationsErrors["landfill.latitude"],
                                )}
                                onChange={(e) => setLandfillDraft((p) => ({ ...p, latitude: Number(e.target.value) }))}
                                onBlur={() => markFieldTouched("landfill.latitude")}
                                className="input-field"
                              />
                              {renderFieldError("landfill.latitude", operationsErrors)}
                            </div>
                            <div className="space-y-1">
                              <label htmlFor="landfill-lng" className="block text-sm font-medium text-gray-800">
                                Longitude
                              </label>
                              <input
                                id="landfill-lng"
                                type="number"
                                step="any"
                                disabled={!isAdmin}
                                value={landfillDraft.longitude}
                                aria-invalid={Boolean(
                                  touched["landfill.longitude"] && operationsErrors["landfill.longitude"],
                                )}
                                onChange={(e) => setLandfillDraft((p) => ({ ...p, longitude: Number(e.target.value) }))}
                                onBlur={() => markFieldTouched("landfill.longitude")}
                                className="input-field"
                              />
                              {renderFieldError("landfill.longitude", operationsErrors)}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label htmlFor="landfill-url" className="block text-sm font-medium text-gray-800">
                              External Google Maps Link
                            </label>
                            <input
                              id="landfill-url"
                              type="url"
                              disabled={!isAdmin}
                              value={landfillDraft.google_maps_url}
                              aria-invalid={Boolean(
                                touched["landfill.google_maps_url"] && operationsErrors["landfill.google_maps_url"],
                              )}
                              onChange={(e) => setLandfillDraft((p) => ({ ...p, google_maps_url: e.target.value }))}
                              onBlur={() => markFieldTouched("landfill.google_maps_url")}
                              className="input-field"
                            />
                            {renderFieldError("landfill.google_maps_url", operationsErrors)}
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* Fleet Monitoring & Routing Thresholds */}
                    <section aria-labelledby="heading-ops-rules" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
                      <h2 id="heading-ops-rules" className="text-base font-semibold text-gray-900">
                        Telemetry Thresholds &amp; Routing Behavior
                      </h2>
                      <p className="mt-1 text-sm text-gray-600">
                        Controls Live Monitoring staleness states, landfill proximity detection, and route duration math.
                      </p>

                      <div className="mt-5 space-y-5">
                        <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-4 space-y-4">
                          <h3 className="text-sm font-semibold text-gray-900">Collection Operating Window</h3>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-1">
                              <label htmlFor="ops-hours-start" className="block text-sm font-medium text-gray-800">
                                Operating Start
                              </label>
                              <p id="hint-ops-start" className="text-xs text-gray-500">
                                Default shift window start.
                              </p>
                              <input
                                id="ops-hours-start"
                                type="time"
                                disabled={!isAdmin}
                                value={opsDraft.operatingHoursStart}
                                aria-describedby="hint-ops-start"
                                aria-invalid={Boolean(
                                  touched["ops.operatingHoursStart"] && operationsErrors["ops.operatingHoursStart"],
                                )}
                                onChange={(e) => setOpsDraft((p) => ({ ...p, operatingHoursStart: e.target.value }))}
                                onBlur={() => markFieldTouched("ops.operatingHoursStart")}
                                className="input-field"
                              />
                              {renderFieldError("ops.operatingHoursStart", operationsErrors)}
                            </div>

                            <div className="space-y-1">
                              <label htmlFor="ops-hours-end" className="block text-sm font-medium text-gray-800">
                                Operating End
                              </label>
                              <p id="hint-ops-end" className="text-xs text-gray-500">
                                Default shift window end.
                              </p>
                              <input
                                id="ops-hours-end"
                                type="time"
                                disabled={!isAdmin}
                                value={opsDraft.operatingHoursEnd}
                                aria-describedby="hint-ops-end"
                                aria-invalid={Boolean(
                                  touched["ops.operatingHoursEnd"] && operationsErrors["ops.operatingHoursEnd"],
                                )}
                                onChange={(e) => setOpsDraft((p) => ({ ...p, operatingHoursEnd: e.target.value }))}
                                onBlur={() => markFieldTouched("ops.operatingHoursEnd")}
                                className="input-field"
                              />
                              {renderFieldError("ops.operatingHoursEnd", operationsErrors)}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-4 space-y-4">
                          <h3 className="text-sm font-semibold text-gray-900">Fleet Telemetry Staleness Thresholds</h3>

                          <div className="space-y-1">
                            <label htmlFor="ops-gps-delayed" className="block text-sm font-medium text-gray-800">
                              GPS Delayed Threshold (seconds)
                            </label>
                            <p id="hint-gps-delayed" className="text-xs text-gray-500">
                              Marks an active truck&apos;s GPS feed as delayed (5–300s, default 20s).
                            </p>
                            <input
                              id="ops-gps-delayed"
                              type="number"
                              min={5}
                              max={300}
                              disabled={!isAdmin}
                              value={opsDraft.gpsDelayedSeconds}
                              aria-describedby="hint-gps-delayed"
                              aria-invalid={Boolean(
                                touched["ops.gpsDelayedSeconds"] && operationsErrors["ops.gpsDelayedSeconds"],
                              )}
                              onChange={(e) => setOpsDraft((p) => ({ ...p, gpsDelayedSeconds: Number(e.target.value) }))}
                              onBlur={() => markFieldTouched("ops.gpsDelayedSeconds")}
                              className="input-field"
                            />
                            {renderFieldError("ops.gpsDelayedSeconds", operationsErrors)}
                          </div>

                          <div className="space-y-1">
                            <label htmlFor="ops-gps-stopped" className="block text-sm font-medium text-gray-800">
                              GPS Stale / Stopped Threshold (seconds)
                            </label>
                            <p id="hint-gps-stopped" className="text-xs text-gray-500">
                              Marks a non-moving feed as stopped/stale (greater than delayed, up to 600s, default 60s).
                            </p>
                            <input
                              id="ops-gps-stopped"
                              type="number"
                              min={10}
                              max={600}
                              disabled={!isAdmin}
                              value={opsDraft.gpsStoppedSeconds}
                              aria-describedby="hint-gps-stopped"
                              aria-invalid={Boolean(
                                touched["ops.gpsStoppedSeconds"] && operationsErrors["ops.gpsStoppedSeconds"],
                              )}
                              onChange={(e) => setOpsDraft((p) => ({ ...p, gpsStoppedSeconds: Number(e.target.value) }))}
                              onBlur={() => markFieldTouched("ops.gpsStoppedSeconds")}
                              className="input-field"
                            />
                            {renderFieldError("ops.gpsStoppedSeconds", operationsErrors)}
                          </div>

                          <div className="space-y-1">
                            <label htmlFor="ops-driver-offline" className="block text-sm font-medium text-gray-800">
                              Driver Offline Threshold (seconds)
                            </label>
                            <p id="hint-driver-offline" className="text-xs text-gray-500">
                              Marks a driver without heartbeat or GPS updates as offline (at least stopped, up to 1800s, default 120s).
                            </p>
                            <input
                              id="ops-driver-offline"
                              type="number"
                              min={30}
                              max={1800}
                              disabled={!isAdmin}
                              value={opsDraft.driverOfflineSeconds}
                              aria-describedby="hint-driver-offline"
                              aria-invalid={Boolean(
                                touched["ops.driverOfflineSeconds"] && operationsErrors["ops.driverOfflineSeconds"],
                              )}
                              onChange={(e) =>
                                setOpsDraft((p) => ({ ...p, driverOfflineSeconds: Number(e.target.value) }))
                              }
                              onBlur={() => markFieldTouched("ops.driverOfflineSeconds")}
                              className="input-field"
                            />
                            {renderFieldError("ops.driverOfflineSeconds", operationsErrors)}
                          </div>
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-4 space-y-4">
                          <h3 className="text-sm font-semibold text-gray-900">Disposal Geofence &amp; Route Timing</h3>

                          <div className="space-y-1">
                            <label htmlFor="ops-landfill-radius" className="block text-sm font-medium text-gray-800">
                              Landfill Proximity Radius (meters)
                            </label>
                            <p id="hint-landfill-radius" className="text-xs text-gray-500">
                              Distance from the disposal site marking an active truck as Returning/At Landfill (100–5000 m, default 850 m).
                            </p>
                            <input
                              id="ops-landfill-radius"
                              type="number"
                              min={100}
                              max={5000}
                              disabled={!isAdmin}
                              value={opsDraft.landfillProximityMeters}
                              aria-describedby="hint-landfill-radius"
                              aria-invalid={Boolean(
                                touched["ops.landfillProximityMeters"] && operationsErrors["ops.landfillProximityMeters"],
                              )}
                              onChange={(e) =>
                                setOpsDraft((p) => ({ ...p, landfillProximityMeters: Number(e.target.value) }))
                              }
                              onBlur={() => markFieldTouched("ops.landfillProximityMeters")}
                              className="input-field"
                            />
                            {renderFieldError("ops.landfillProximityMeters", operationsErrors)}
                          </div>

                          <div className="space-y-1">
                            <label htmlFor="ops-stop-minutes" className="block text-sm font-medium text-gray-800">
                              Per-Stop Handling Time (minutes)
                            </label>
                            <p id="hint-stop-minutes" className="text-xs text-gray-500">
                              Service time added per bin stop when estimating total route duration (1–30 min, default 3 min).
                            </p>
                            <input
                              id="ops-stop-minutes"
                              type="number"
                              min={1}
                              max={30}
                              disabled={!isAdmin}
                              value={opsDraft.stopHandlingMinutes}
                              aria-describedby="hint-stop-minutes"
                              aria-invalid={Boolean(
                                touched["ops.stopHandlingMinutes"] && operationsErrors["ops.stopHandlingMinutes"],
                              )}
                              onChange={(e) =>
                                setOpsDraft((p) => ({ ...p, stopHandlingMinutes: Number(e.target.value) }))
                              }
                              onBlur={() => markFieldTouched("ops.stopHandlingMinutes")}
                              className="input-field"
                            />
                            {renderFieldError("ops.stopHandlingMinutes", operationsErrors)}
                          </div>

                          <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3.5">
                            <input
                              id="ops-prefer-traffic"
                              type="checkbox"
                              disabled={!isAdmin}
                              checked={opsDraft.preferTrafficRouting}
                              onChange={(e) => setOpsDraft((p) => ({ ...p, preferTrafficRouting: e.target.checked }))}
                              className="mt-1 size-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-600"
                            />
                            <div>
                              <label htmlFor="ops-prefer-traffic" className="block text-sm font-medium text-gray-900">
                                Prefer Mapbox Traffic-Aware Directions (<code className="text-xs">driving-traffic</code>)
                              </label>
                              <p className="mt-0.5 text-xs text-gray-600">
                                Queries live traffic conditions first when calculating street routes, falling back to
                                standard <code className="text-xs">driving</code> or OSRM if unavailable.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              )}

              {activeTab === "map" && (
                <section aria-labelledby="heading-map-defaults" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 id="heading-map-defaults" className="text-base font-semibold text-gray-900">
                        Default Map Viewport, Style &amp; Fleet Marker Behavior
                      </h2>
                      <p className="mt-1 text-sm text-gray-600">
                        Applied across Live Fleet Monitoring, Bin Location Picker, and Route Street Previews.
                      </p>
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() =>
                          setMapDraft((prev) => ({
                            ...prev,
                            centerLatitude: depotDraft.latitude,
                            centerLongitude: depotDraft.longitude,
                          }))
                        }
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Center on Dispatch Depot
                      </button>
                    )}
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-5">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label htmlFor="map-center-lat" className="block text-sm font-medium text-gray-800">
                            Default Center Latitude
                          </label>
                          <p id="hint-map-lat" className="text-xs text-gray-500">
                            Valid range: -90 to 90.
                          </p>
                          <input
                            id="map-center-lat"
                            type="number"
                            step="any"
                            disabled={!isAdmin}
                            value={mapDraft.centerLatitude}
                            aria-describedby="hint-map-lat"
                            aria-invalid={Boolean(touched["map.centerLatitude"] && mapErrors["map.centerLatitude"])}
                            onChange={(e) => setMapDraft((p) => ({ ...p, centerLatitude: Number(e.target.value) }))}
                            onBlur={() => markFieldTouched("map.centerLatitude")}
                            className="input-field"
                          />
                          {renderFieldError("map.centerLatitude", mapErrors)}
                        </div>

                        <div className="space-y-1">
                          <label htmlFor="map-center-lng" className="block text-sm font-medium text-gray-800">
                            Default Center Longitude
                          </label>
                          <p id="hint-map-lng" className="text-xs text-gray-500">
                            Valid range: -180 to 180.
                          </p>
                          <input
                            id="map-center-lng"
                            type="number"
                            step="any"
                            disabled={!isAdmin}
                            value={mapDraft.centerLongitude}
                            aria-describedby="hint-map-lng"
                            aria-invalid={Boolean(touched["map.centerLongitude"] && mapErrors["map.centerLongitude"])}
                            onChange={(e) => setMapDraft((p) => ({ ...p, centerLongitude: Number(e.target.value) }))}
                            onBlur={() => markFieldTouched("map.centerLongitude")}
                            className="input-field"
                          />
                          {renderFieldError("map.centerLongitude", mapErrors)}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="map-default-zoom" className="block text-sm font-medium text-gray-800">
                          Default Initial Zoom (11–18)
                        </label>
                        <p id="hint-map-zoom" className="text-xs text-gray-500">
                          Higher values zoom closer to street corridors when maps load with no active markers.
                        </p>
                        <input
                          id="map-default-zoom"
                          type="number"
                          step={0.5}
                          min={11}
                          max={18}
                          disabled={!isAdmin}
                          value={mapDraft.defaultZoom}
                          aria-describedby="hint-map-zoom"
                          aria-invalid={Boolean(touched["map.defaultZoom"] && mapErrors["map.defaultZoom"])}
                          onChange={(e) => setMapDraft((p) => ({ ...p, defaultZoom: Number(e.target.value) }))}
                          onBlur={() => markFieldTouched("map.defaultZoom")}
                          className="input-field"
                        />
                        {renderFieldError("map.defaultZoom", mapErrors)}
                      </div>
                    </div>

                    <div className="space-y-5">
                      <div className="space-y-1">
                        <label htmlFor="map-style" className="block text-sm font-medium text-gray-800">
                          Mapbox Basemap Style
                        </label>
                        <p id="hint-map-style" className="text-xs text-gray-500">
                          Used when Mapbox token is configured; falls back cleanly to OpenStreetMap if unconfigured.
                        </p>
                        <CustomSelect
                          id="map-style"
                          disabled={!isAdmin}
                          value={mapDraft.mapboxStyle}
                          ariaLabel="Mapbox basemap style"
                          options={MAPBOX_STYLE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                          onChange={(val) => setMapDraft((p) => ({ ...p, mapboxStyle: val as MapboxStyleId }))}
                        />
                      </div>

                      <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <input
                          id="map-show-landfill-live"
                          type="checkbox"
                          disabled={!isAdmin}
                          checked={mapDraft.showLandfillOnLiveMap}
                          onChange={(e) => setMapDraft((p) => ({ ...p, showLandfillOnLiveMap: e.target.checked }))}
                          className="mt-1 size-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-600"
                        />
                        <div>
                          <label htmlFor="map-show-landfill-live" className="block text-sm font-medium text-gray-900">
                            Show Sanitary Landfill Marker on Live Fleet Map
                          </label>
                          <p className="mt-0.5 text-xs text-gray-600">
                            Pins the configured landfill disposal site alongside live trucks in Live Monitoring.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {activeTab === "lists" && (
                <ReferenceListsTab
                  allReportCategories={allReportCategories}
                  allMaintenanceTypes={allMaintenanceTypes}
                  allBinTypes={allBinTypes}
                  onCreateItem={(table: ReferenceTableName, name: string) => createReferenceItem(table, { name })}
                  onUpdateItem={(table, id, payload) => updateReferenceItem(table, id, payload)}
                />
              )}

              {activeTab === "security" && (
                <SecurityAuditTab
                  draft={securityDraft}
                  fieldErrors={securityErrors}
                  touched={touched}
                  rolePermissions={rolePermissions}
                  onChange={setSecurityDraft}
                  onBlurField={markFieldTouched}
                  onNavigate={onNavigate}
                />
              )}

              {activeTab === "info" && <SystemInfoTab />}
            </>
          )}
        </div>

        {/* Bottom Action Bar for Editable Settings Tabs */}
        {activeEditableTab && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4">
            <button
              type="button"
              disabled={!isAdmin}
              onClick={() => handleRestoreDefaultsTab(activeEditableTab)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              <span>Restore {activeTabLabel} Defaults</span>
            </button>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={!dirtyByTab[activeEditableTab] || savingTab === activeEditableTab}
                onClick={() => handleDiscardTab(activeEditableTab)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!isAdmin || savingTab === activeEditableTab || !dirtyByTab[activeEditableTab]}
                onClick={() => requestSaveTab(activeEditableTab)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
              >
                <Save className="size-4" aria-hidden="true" />
                <span>{savingTab === activeEditableTab ? "Saving…" : `Save ${activeTabLabel}`}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmModalCopy && (
        <ConfirmModal
          isOpen={Boolean(pendingConfirmTab)}
          onClose={() => setPendingConfirmTab(null)}
          onConfirm={() => {
            if (pendingConfirmTab) {
              return persistTab(pendingConfirmTab);
            }
          }}
          title={confirmModalCopy.title}
          message={confirmModalCopy.message}
          confirmText="Apply & Save"
          cancelText="Review Changes"
          variant={confirmModalCopy.variant}
        />
      )}

      <Toast
        isOpen={toast.open}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}
