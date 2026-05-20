import { useEffect, useState } from "react";
import { LockKeyhole, ShieldCheck, SlidersHorizontal } from "lucide-react";
import NotificationDropdown from "../components/feedback/NotificationDropdown";
import Toast from "../components/feedback/Toast";
import { useLiveData } from "../hooks/useLiveData";

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

export default function SystemSettings({ onNavigate }: SystemSettingsProps) {
  const { settings, rolePermissions, reportCategories, maintenanceTypes, serviceAreas, binTypes, loading, error, upsertSystemSetting } = useLiveData();
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
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setDepotForm({
      id: depot.id ?? "DEPOT",
      latitude: String(depot.latitude ?? ""),
      longitude: String(depot.longitude ?? ""),
    });
    setOrganizationForm({
      name: organization.name ?? "",
      city: organization.city ?? "",
    });
  }, [depot.id, depot.latitude, depot.longitude, organization.name, organization.city]);

  const saveSettings = async () => {
    await upsertSystemSetting("depot", {
      id: depotForm.id,
      latitude: Number(depotForm.latitude),
      longitude: Number(depotForm.longitude),
    }, "Default dispatch depot for route optimization");
    await upsertSystemSetting("organization", organizationForm, "Displayed organization identity");
    setToast("Settings saved successfully.");
  };

  return (
    <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-gray-900">System Settings</h2>
            <p className="text-gray-600">Configure organization details, depot location, and who can access each area of the platform.</p>
          </div>
          {onNavigate && <NotificationDropdown onViewAll={() => onNavigate("notifications")} />}
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <ShieldCheck className="size-6 text-emerald-600 mb-3" />
            <h3 className="font-semibold text-gray-900">Authentication</h3>
            <p className="text-sm text-gray-600 mt-2">Staff sign-in and account status control who can use the web dashboard.</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <LockKeyhole className="size-6 text-blue-600 mb-3" />
            <h3 className="font-semibold text-gray-900">Role Access</h3>
            <p className="text-sm text-gray-600 mt-2">Each role has permissions for viewing and editing specific screens.</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <SlidersHorizontal className="size-6 text-purple-600 mb-3" />
            <h3 className="font-semibold text-gray-900">Reference Data</h3>
            <p className="text-sm text-gray-600 mt-2">Report categories, service areas, bin types, and maintenance types used across the system.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4">Organization</h3>
            <div className="space-y-3">
              <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Organization name" value={organizationForm.name} onChange={(event) => setOrganizationForm({ ...organizationForm, name: event.target.value })} />
              <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="City" value={organizationForm.city} onChange={(event) => setOrganizationForm({ ...organizationForm, city: event.target.value })} />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4">Dispatch Depot</h3>
            <div className="space-y-3">
              <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Depot ID" value={depotForm.id} onChange={(event) => setDepotForm({ ...depotForm, id: event.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Latitude" value={depotForm.latitude} onChange={(event) => setDepotForm({ ...depotForm, latitude: event.target.value })} />
                <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Longitude" value={depotForm.longitude} onChange={(event) => setDepotForm({ ...depotForm, longitude: event.target.value })} />
              </div>
              <button onClick={() => void saveSettings()} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                Save Settings
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">Role permissions overview</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Page</th>
                  <th className="px-4 py-3 text-left">Read</th>
                  <th className="px-4 py-3 text-left">Create</th>
                  <th className="px-4 py-3 text-left">Update</th>
                  <th className="px-4 py-3 text-left">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rolePermissions.map((permission) => (
                  <tr key={`${permission.role}-${permission.page}`}>
                    <td className="px-4 py-3 font-medium text-gray-900 capitalize">{permission.role.replace("_", " ")}</td>
                    <td className="px-4 py-3 text-gray-700">{permission.page}</td>
                    <td className="px-4 py-3">{permission.can_read ? "Yes" : "No"}</td>
                    <td className="px-4 py-3">{permission.can_create ? "Yes" : "No"}</td>
                    <td className="px-4 py-3">{permission.can_update ? "Yes" : "No"}</td>
                    <td className="px-4 py-3">{permission.can_delete ? "Yes" : "No"}</td>
                  </tr>
                ))}
                {!loading && rolePermissions.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-gray-500" colSpan={6}>No role permissions found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <ReferenceCard title="Report Categories" items={reportCategories.map((item) => item.name)} />
          <ReferenceCard title="Maintenance Types" items={maintenanceTypes.map((item) => item.name)} />
          <ReferenceCard title="Service Areas" items={serviceAreas.map((item) => item.name)} />
          <ReferenceCard title="Bin Types" items={binTypes.map((item) => item.name)} />
        </div>
      </div>
      {toast && <Toast message={toast} type="success" onClose={() => setToast(null)} />}
    </div>
  );
}

function ReferenceCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <h3 className="font-semibold text-gray-900 mb-3">{title}</h3>
      <div className="space-y-1">
        {items.map((item) => (
          <p key={item} className="text-sm text-gray-600">{item}</p>
        ))}
        {items.length === 0 && <p className="text-sm text-gray-500">No records.</p>}
      </div>
    </div>
  );
}
