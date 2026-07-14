import { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle, Database, MapPin, Plus } from "lucide-react";
import NotificationDropdown from "../components/feedback/NotificationDropdown";
import RoleIndicator from "../components/layout/RoleIndicator";
import Toast from "../components/feedback/Toast";
import { type ReferenceRecord, type ReferenceTableName, useLiveData } from "../hooks/useLiveData";

type PageType =
  | "dashboard"
  | "route-planning"
  | "vehicle-monitoring"
  | "reports"
  | "bin-locations"
  | "notifications"
  | "user-approvals"
  | "supervisor-dashboard"
  | "system-settings";

interface SystemSettingsProps {
  onNavigate?: (page: PageType) => void;
}

type ReferenceSection = {
  id: ReferenceTableName;
  label: string;
  description: string;
  items: ReferenceRecord[];
};

const referenceTabs: Array<{ id: ReferenceTableName; label: string }> = [
  { id: "report_categories", label: "Report Categories" },
  { id: "maintenance_types", label: "Maintenance Types" },
  { id: "service_areas", label: "Service Areas" },
  { id: "bin_types", label: "Bin Types" },
];

export default function SystemSettings({ onNavigate }: SystemSettingsProps) {
  const {
    settings,
    error,
    allReportCategories,
    allMaintenanceTypes,
    allServiceAreas,
    allBinTypes,
    upsertSystemSetting,
    createReferenceItem,
    updateReferenceItem,
  } = useLiveData();
  const depot = settings.find((setting) => setting.key === "depot")?.value ?? {};
  const organization = settings.find((setting) => setting.key === "organization")?.value ?? {};
  const [depotForm, setDepotForm] = useState({
    id: depot.id ?? "DEPOT",
    latitude: String(depot.latitude ?? ""),
    longitude: String(depot.longitude ?? ""),
  });
  const [organizationForm, setOrganizationForm] = useState({
    name: organization.name ?? "",
    city: organization.city ?? "",
  });
  const [activeReferenceTab, setActiveReferenceTab] = useState<ReferenceTableName>("report_categories");
  const [newReference, setNewReference] = useState({ name: "", sortOrder: "" });
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    setDepotForm({
      id: depot.id ?? "DEPOT",
      latitude: String(depot.latitude ?? ""),
      longitude: String(depot.longitude ?? ""),
    });
  }, [depot.id, depot.latitude, depot.longitude]);

  useEffect(() => {
    setOrganizationForm({
      name: organization.name ?? "",
      city: organization.city ?? "",
    });
  }, [organization.name, organization.city]);

  const referenceSections: ReferenceSection[] = useMemo(
    () => [
      { id: "report_categories", label: "Report Categories", description: "Options used to classify driver and waste reports.", items: allReportCategories },
      { id: "maintenance_types", label: "Maintenance Types", description: "Options used when scheduling vehicle maintenance.", items: allMaintenanceTypes },
      { id: "service_areas", label: "Service Areas", description: "Named operating areas for city waste collection.", items: allServiceAreas },
      { id: "bin_types", label: "Bin Types", description: "Collection site types available when adding bins.", items: allBinTypes },
    ],
    [allBinTypes, allMaintenanceTypes, allReportCategories, allServiceAreas],
  );
  const activeReferenceSection = referenceSections.find((section) => section.id === activeReferenceTab) ?? referenceSections[0];

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
  };

  const saveDepotSettings = async () => {
    try {
      await upsertSystemSetting("depot", {
        id: depotForm.id,
        latitude: Number(depotForm.latitude),
        longitude: Number(depotForm.longitude),
      }, "Default dispatch depot for route optimization");
      showToast("Depot settings saved.");
    } catch (err: any) {
      showToast(err?.message ?? "Unable to save depot settings.", "error");
    }
  };

  const saveOrganizationSettings = async () => {
    try {
      await upsertSystemSetting("organization", organizationForm, "Displayed organization identity");
      showToast("Organization profile saved.");
    } catch (err: any) {
      showToast(err?.message ?? "Unable to save organization profile.", "error");
    }
  };

  const addReferenceItem = async () => {
    try {
      const name = newReference.name.trim();
      if (!name) {
        showToast("Reference name is required.", "error");
        return;
      }
      await createReferenceItem(activeReferenceTab, {
        name,
        is_active: true,
        sort_order: newReference.sortOrder ? Number(newReference.sortOrder) : 100,
      });
      setNewReference({ name: "", sortOrder: "" });
      showToast("Reference item added.");
    } catch (err: any) {
      showToast(err?.message ?? "Unable to add reference item.", "error");
    }
  };

  const updateReference = async (table: ReferenceTableName, item: ReferenceRecord, payload: Partial<Pick<ReferenceRecord, "name" | "is_active" | "sort_order">>) => {
    try {
      await updateReferenceItem(table, item.id, payload);
      showToast("Reference item updated.");
    } catch (err: any) {
      showToast(err?.message ?? "Unable to update reference item.", "error");
    }
  };

  return (
    <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">
      <div className="space-y-6 w-full max-w-none">
        <RoleIndicator />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-gray-900">System Settings</h2>
            <p className="text-gray-600">Configure organization identity, routing defaults, and admin reference data.</p>
          </div>
          {onNavigate && <NotificationDropdown onViewAll={() => onNavigate("notifications")} />}
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <SectionHeader icon={<Building2 className="size-5 text-emerald-600" />} title="Organization Profile" description="Set the organization identity used across admin exports and system records." />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Organization Name">
                <input className="field" placeholder="Organization name" value={organizationForm.name} onChange={(event) => setOrganizationForm({ ...organizationForm, name: event.target.value })} />
              </Field>
              <Field label="City">
                <input className="field" placeholder="City" value={organizationForm.city} onChange={(event) => setOrganizationForm({ ...organizationForm, city: event.target.value })} />
              </Field>
            </div>
            <button onClick={() => void saveOrganizationSettings()} className="mt-5 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
              Save Organization
            </button>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <SectionHeader icon={<MapPin className="size-5 text-emerald-600" />} title="Dispatch Depot" description="Set the default depot coordinates used when building optimized routes." />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Depot ID">
                <input className="field" placeholder="Depot ID" value={depotForm.id} onChange={(event) => setDepotForm({ ...depotForm, id: event.target.value })} />
              </Field>
              <Field label="Latitude">
                <input className="field" placeholder="Latitude" value={depotForm.latitude} onChange={(event) => setDepotForm({ ...depotForm, latitude: event.target.value })} />
              </Field>
              <Field label="Longitude">
                <input className="field" placeholder="Longitude" value={depotForm.longitude} onChange={(event) => setDepotForm({ ...depotForm, longitude: event.target.value })} />
              </Field>
            </div>
            <button onClick={() => void saveDepotSettings()} className="mt-5 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
              Save Depot
            </button>
          </section>
        </div>

        <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionHeader icon={<Database className="size-5 text-emerald-600" />} title="Reference Data Manager" description="Manage dropdown and classification values without deleting historical references." />
          <div className="flex flex-wrap gap-2 mb-5">
            {referenceTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveReferenceTab(tab.id);
                  setNewReference({ name: "", sortOrder: "" });
                }}
                className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                  activeReferenceTab === tab.id
                    ? "bg-emerald-600 border-emerald-600 text-white"
                    : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">{activeReferenceSection.label}</h3>
              <p className="text-sm text-gray-600 mt-1">{activeReferenceSection.description}</p>
            </div>
            <div className="divide-y divide-gray-100">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_140px_120px_auto] gap-3 p-4 bg-white">
                <input className="field" placeholder={`Add ${activeReferenceSection.label.toLowerCase()}`} value={newReference.name} onChange={(event) => setNewReference({ ...newReference, name: event.target.value })} />
                <input className="field" placeholder="Sort order" value={newReference.sortOrder} onChange={(event) => setNewReference({ ...newReference, sortOrder: event.target.value })} />
                <div className="hidden lg:block" />
                <button onClick={() => void addReferenceItem()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">
                  <Plus className="size-4" />
                  Add
                </button>
              </div>

              {activeReferenceSection.items.map((item) => (
                <ReferenceRow key={item.id} table={activeReferenceSection.id} item={item} onUpdate={updateReference} />
              ))}
              {activeReferenceSection.items.length === 0 && <div className="p-6 text-sm text-gray-500">No reference records found.</div>}
            </div>
          </div>
        </section>
      </div>
      <style dangerouslySetInnerHTML={{ __html: ".field{width:100%;padding:0.625rem 0.75rem;border:1px solid #d1d5db;border-radius:0.5rem;outline:none}.field:focus{border-color:#10b981;box-shadow:0 0 0 2px rgba(16,185,129,.2)}" }} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

function SectionHeader({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="rounded-lg bg-emerald-50 p-2">{icon}</div>
      <div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600 mt-1">{description}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function ReferenceRow({
  table,
  item,
  onUpdate,
}: {
  table: ReferenceTableName;
  item: ReferenceRecord;
  onUpdate: (table: ReferenceTableName, item: ReferenceRecord, payload: Partial<Pick<ReferenceRecord, "name" | "is_active" | "sort_order">>) => Promise<void>;
}) {
  const [name, setName] = useState(item.name);
  const [sortOrder, setSortOrder] = useState(String(item.sort_order ?? ""));

  useEffect(() => {
    setName(item.name);
    setSortOrder(String(item.sort_order ?? ""));
  }, [item.name, item.sort_order]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_140px_120px_auto] gap-3 p-4 items-center">
      <input className="field" value={name} onChange={(event) => setName(event.target.value)} onBlur={() => name.trim() !== item.name && void onUpdate(table, item, { name: name.trim() })} />
      <input
        className="field"
        value={sortOrder}
        onChange={(event) => setSortOrder(event.target.value)}
        onBlur={() => {
          const nextSort = sortOrder === "" ? null : Number(sortOrder);
          if (nextSort !== item.sort_order && nextSort !== null) void onUpdate(table, item, { sort_order: nextSort });
        }}
      />
      <button
        onClick={() => void onUpdate(table, item, { is_active: !(item.is_active ?? true) })}
        className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm ${
          item.is_active ?? true ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        }`}
      >
        <CheckCircle className="size-4" />
        {item.is_active ?? true ? "Active" : "Inactive"}
      </button>
      <span className="text-xs text-gray-500 lg:text-right">ID: {item.id}</span>
    </div>
  );
}
