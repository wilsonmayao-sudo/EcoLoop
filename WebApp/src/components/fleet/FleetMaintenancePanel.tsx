import React, { useMemo, useState } from "react";
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Truck,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import ConfirmModal from "../feedback/ConfirmModal";
import CustomSelect from "../ui/CustomSelect";
import {
  formatDateTime,
  normalizeStatus,
  useLiveData,
  type MaintenanceRecord,
  type VehicleRecord,
} from "../../hooks/useLiveData";
import { formatMassDisplay, formatVolumeDisplay } from "../../utils/systemSettings";

interface FleetMaintenancePanelProps {
  canManage: boolean;
}

const VEHICLE_STATUS_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "on_route", label: "On Route" },
  { value: "maintenance", label: "In Maintenance" },
  { value: "full", label: "Full Capacity" },
  { value: "unloading", label: "Unloading" },
  { value: "offline", label: "Offline" },
];

const MAINTENANCE_STATUS_FILTER_OPTIONS = [
  { value: "ALL", label: "All Records" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const emptyVehicleForm = {
  code: "",
  plate_number: "",
  label: "",
  model: "",
  capacity_m3: "",
  capacity_kg: "",
  status: "available",
  driver_id: "",
};

const emptyMaintenanceForm = {
  vehicle_id: "",
  maintenance_type: "",
  scheduled_at: "",
  estimated_duration_minutes: "60",
  notes: "",
  mark_vehicle_in_maintenance: false,
};

function formatDateTimeLocalDefault(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function vehicleStatusBadge(vehicle: VehicleRecord): { label: string; cls: string } {
  if (vehicle.is_active === false) {
    return { label: "Inactive", cls: "bg-gray-100 text-gray-600" };
  }
  const s = normalizeStatus(vehicle.status);
  if (s === "on_route" || s === "active") return { label: "On Route", cls: "bg-emerald-100 text-emerald-800" };
  if (s === "maintenance") return { label: "Maintenance", cls: "bg-amber-100 text-amber-800" };
  if (s === "full" || s === "unloading") return { label: s === "full" ? "Full" : "Unloading", cls: "bg-orange-100 text-orange-800" };
  if (s === "offline") return { label: "Offline", cls: "bg-red-100 text-red-700" };
  return { label: "Available", cls: "bg-blue-100 text-blue-800" };
}

function maintenanceStatusBadge(status: string): { label: string; cls: string } {
  const s = normalizeStatus(status);
  if (s === "in_progress") return { label: "In Progress", cls: "bg-amber-100 text-amber-800" };
  if (s === "completed") return { label: "Completed", cls: "bg-emerald-100 text-emerald-800" };
  if (s === "cancelled") return { label: "Cancelled", cls: "bg-gray-100 text-gray-600" };
  return { label: "Scheduled", cls: "bg-blue-100 text-blue-800" };
}

export default function FleetMaintenancePanel({ canManage }: FleetMaintenancePanelProps) {
  const {
    vehicles,
    drivers,
    routes,
    maintenanceRecords,
    maintenanceTypes,
    operationsConfig,
    vehicleById,
    driverById,
    createVehicle,
    updateVehicle,
    assignVehicleDriver,
    deleteVehicle,
    createMaintenanceRecord,
    updateMaintenanceRecord,
  } = useLiveData();

  const [vehicleSearch, setVehicleSearch] = useState("");
  const [vehicleStatusFilter, setVehicleStatusFilter] = useState("ALL");
  const [maintStatusFilter, setMaintStatusFilter] = useState("ALL");
  const [maintVehicleFilter, setMaintVehicleFilter] = useState("ALL");

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add / Edit Vehicle modal state
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VehicleRecord | null>(null);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm);
  const [vehicleToToggle, setVehicleToToggle] = useState<VehicleRecord | null>(null);
  const [vehicleToDelete, setVehicleToDelete] = useState<VehicleRecord | null>(null);

  // Schedule Maintenance modal state
  const [showMaintModal, setShowMaintModal] = useState(false);
  const [maintForm, setMaintForm] = useState(emptyMaintenanceForm);

  const driverIdByVehicleId = useMemo(() => {
    const map = new Map<string, string>();
    vehicles.forEach((v) => {
      if (v.driver_id != null) {
        map.set(String(v.id), String(v.driver_id));
      }
    });
    drivers.forEach((d) => {
      if (d.assigned_vehicle_id != null) {
        map.set(String(d.assigned_vehicle_id), String(d.id));
      }
    });
    return map;
  }, [drivers, vehicles]);

  const driverNameByVehicleId = useMemo(() => {
    const map = new Map<string, string>();
    driverIdByVehicleId.forEach((driverId, vehicleId) => {
      const driver = driverById.get(driverId);
      if (driver) {
        map.set(vehicleId, driver.name);
      }
    });
    return map;
  }, [driverById, driverIdByVehicleId]);

  const activeDrivers = useMemo(
    () =>
      drivers.filter((d) => {
        const status = normalizeStatus(d.status);
        return status !== "inactive" && status !== "suspended";
      }),
    [drivers],
  );

  const driverSelectOptions = useMemo(
    () => [
      { value: "", label: "Unassigned" },
      ...activeDrivers.map((d) => {
        const seenMs = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0;
        const isOnline =
          seenMs > 0 &&
          Date.now() - seenMs <= operationsConfig.driverOfflineSeconds * 1000 &&
          normalizeStatus(d.status) !== "offline";
        return {
          value: String(d.id),
          label: d.name,
          colorClassName: isOnline ? "bg-emerald-500" : "bg-gray-400",
        };
      }),
    ],
    [activeDrivers, operationsConfig.driverOfflineSeconds],
  );

  const handleInlineDriverAssign = async (vehicleId: string | number, nextDriverId: string) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await assignVehicleDriver(String(vehicleId), nextDriverId || null);
      setNotice("Vehicle driver assignment updated.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to update driver assignment.");
    } finally {
      setBusy(false);
    }
  };

  const handleDriverVehicleAssign = async (driverId: string | number, currentVehicleId: string | number | null | undefined, nextVehicleId: string) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      if (!nextVehicleId) {
        if (currentVehicleId != null) {
          await assignVehicleDriver(String(currentVehicleId), null);
        }
      } else {
        await assignVehicleDriver(String(nextVehicleId), String(driverId));
      }
      setNotice("Driver vehicle assignment updated.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to update vehicle assignment.");
    } finally {
      setBusy(false);
    }
  };

  const maintenanceTypeOptions = useMemo(() => {
    const names = maintenanceTypes.map((m) => m.name).filter(Boolean);
    const list = names.length > 0 ? names : ["Routine Inspection", "Oil Change", "Brake Service", "Tire Replacement", "Engine Repair", "Other"];
    return list.map((name) => ({ value: name, label: name }));
  }, [maintenanceTypes]);

  const vehicleSelectOptions = useMemo(
    () =>
      vehicles.map((v) => ({
        value: String(v.id),
        label: `${v.code || v.truck_code || `TRK-${v.id}`} — ${v.label || v.plate_number || "Truck"}`,
      })),
    [vehicles],
  );

  const availableMaintenanceTruckOptions = useMemo(
    () =>
      vehicles
        .filter((v) => v.is_active !== false && normalizeStatus(v.status) === "available")
        .map((v) => ({
          value: String(v.id),
          label: `${v.code || v.truck_code || `TRK-${v.id}`} — ${v.label || v.plate_number || "Truck"}`,
        })),
    [vehicles],
  );

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((v) => {
      if (vehicleStatusFilter !== "ALL") {
        if (vehicleStatusFilter === "inactive") {
          if (v.is_active !== false) return false;
        } else if (v.is_active === false || normalizeStatus(v.status) !== vehicleStatusFilter) {
          return false;
        }
      }
      if (vehicleSearch.trim()) {
        const q = vehicleSearch.toLowerCase();
        const assignedDriver = driverNameByVehicleId.get(String(v.id)) || "";
        const hay = [v.code, v.truck_code, v.plate_number, v.label, v.model, assignedDriver]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [driverNameByVehicleId, vehicleSearch, vehicleStatusFilter, vehicles]);

  const filteredMaintenance = useMemo(() => {
    return maintenanceRecords.filter((rec) => {
      if (maintStatusFilter !== "ALL" && normalizeStatus(rec.status) !== maintStatusFilter) {
        return false;
      }
      if (maintVehicleFilter !== "ALL" && String(rec.vehicle_id) !== maintVehicleFilter) {
        return false;
      }
      return true;
    });
  }, [maintStatusFilter, maintVehicleFilter, maintenanceRecords]);

  const fleetCounts = useMemo(() => {
    const activeVehicles = vehicles.filter((v) => v.is_active !== false);
    const active = activeVehicles.length;
    const inMaint = activeVehicles.filter((v) => normalizeStatus(v.status) === "maintenance").length;
    const totalKg = vehicles.reduce((sum, v) => sum + (Number(v.capacity_kg) || 0), 0);
    const activeKg = activeVehicles.reduce((sum, v) => sum + (Number(v.capacity_kg) || 0), 0);
    const totalLiters = vehicles.reduce((sum, v) => sum + (Number(v.capacity_liters) || 0), 0);
    const activeLiters = activeVehicles.reduce((sum, v) => sum + (Number(v.capacity_liters) || 0), 0);
    const openWork = maintenanceRecords.filter((m) => {
      const s = normalizeStatus(m.status);
      return s === "scheduled" || s === "in_progress";
    }).length;
    return {
      total: vehicles.length,
      active,
      inMaint,
      openWork,
      totalKg: Math.round(totalKg * 10) / 10,
      activeKg: Math.round(activeKg * 10) / 10,
      totalLiters,
      activeLiters,
    };
  }, [maintenanceRecords, vehicles]);

  const openAddVehicle = () => {
    setEditingVehicle(null);
    setVehicleForm(emptyVehicleForm);
    setActionError(null);
    setShowVehicleModal(true);
  };

  const openEditVehicle = (vehicle: VehicleRecord) => {
    setEditingVehicle(vehicle);
    setVehicleForm({
      code: vehicle.code || vehicle.truck_code || "",
      plate_number: vehicle.plate_number || "",
      label: vehicle.label || "",
      model: vehicle.model || "",
      capacity_m3: vehicle.capacity_liters != null ? String(Math.round((Number(vehicle.capacity_liters) / 1000) * 100) / 100) : "",
      capacity_kg: vehicle.capacity_kg != null ? String(vehicle.capacity_kg) : "",
      status: normalizeStatus(vehicle.status) || "available",
      driver_id: driverIdByVehicleId.get(String(vehicle.id)) ?? "",
    });
    setActionError(null);
    setShowVehicleModal(true);
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    const cleanCode = vehicleForm.code.trim().toUpperCase();
    const cleanPlate = vehicleForm.plate_number.trim().toUpperCase();
    const cleanLabel = vehicleForm.label.trim();
    if (!cleanCode || !cleanPlate || !cleanLabel) {
      setActionError("Truck code, plate number, and truck name/label are required.");
      return;
    }

    const parsedM3 = vehicleForm.capacity_m3.trim() ? Number(vehicleForm.capacity_m3) : null;
    if (parsedM3 !== null && (!Number.isFinite(parsedM3) || parsedM3 <= 0)) {
      setActionError("Volume capacity (m³) must be a positive number.");
      return;
    }
    const parsedCap = vehicleForm.capacity_kg.trim()
      ? Number(vehicleForm.capacity_kg)
      : parsedM3 !== null
        ? Math.round(parsedM3 * 294 * 10) / 10
        : null;
    if (parsedCap !== null && (!Number.isFinite(parsedCap) || parsedCap <= 0)) {
      setActionError("Capacity (kg) must be a positive number.");
      return;
    }

    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const payload: Partial<VehicleRecord> = {
        code: cleanCode,
        truck_code: cleanCode,
        plate_number: cleanPlate,
        label: cleanLabel,
        model: vehicleForm.model.trim() || null,
        capacity_liters: parsedM3 !== null ? Math.round(parsedM3 * 1000 * 100) / 100 : null,
        capacity_kg: parsedCap,
        status: vehicleForm.status || "available",
      };

      if (editingVehicle) {
        const previousDriverId = driverIdByVehicleId.get(String(editingVehicle.id)) ?? "";
        await updateVehicle(String(editingVehicle.id), payload);
        if (vehicleForm.driver_id !== previousDriverId) {
          await assignVehicleDriver(String(editingVehicle.id), vehicleForm.driver_id || null);
        }
        setNotice(`Updated truck ${cleanCode} (${cleanPlate}).`);
      } else {
        const created = await createVehicle({ ...payload, is_active: true });
        if (vehicleForm.driver_id && created?.id != null) {
          await assignVehicleDriver(String(created.id), vehicleForm.driver_id);
        }
        setNotice(`Added truck ${cleanCode} (${cleanPlate}) to fleet.`);
      }
      setShowVehicleModal(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save truck.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeleteVehicle = async () => {
    if (!vehicleToDelete || !canManage) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await deleteVehicle(String(vehicleToDelete.id));
      setNotice(`Removed truck ${vehicleToDelete.code || vehicleToDelete.label} from database.`);
      setVehicleToDelete(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to delete truck.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmToggleVehicleActive = async () => {
    if (!vehicleToToggle || !canManage) return;
    const nextActive = vehicleToToggle.is_active === false;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await updateVehicle(String(vehicleToToggle.id), {
        is_active: nextActive,
        status: nextActive ? "available" : "offline",
      });
      setNotice(
        `${vehicleToToggle.code || vehicleToToggle.label} ${nextActive ? "reactivated" : "deactivated"}.`,
      );
      setVehicleToToggle(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to update truck status.");
    } finally {
      setBusy(false);
    }
  };

  const openScheduleMaintenance = () => {
    setMaintForm({
      vehicle_id: availableMaintenanceTruckOptions[0]?.value ?? "",
      maintenance_type: maintenanceTypeOptions[0]?.value ?? "Routine Inspection",
      scheduled_at: formatDateTimeLocalDefault(),
      estimated_duration_minutes: "60",
      notes: "",
      mark_vehicle_in_maintenance: false,
    });
    setActionError(null);
    setShowMaintModal(true);
  };

  const handleSaveMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    if (!maintForm.vehicle_id || !maintForm.maintenance_type || !maintForm.scheduled_at) {
      setActionError("Vehicle, maintenance type, and scheduled date/time are required.");
      return;
    }

    const scheduledIso = new Date(maintForm.scheduled_at);
    if (Number.isNaN(scheduledIso.getTime())) {
      setActionError("Please enter a valid scheduled date and time.");
      return;
    }

    const durationMin = maintForm.estimated_duration_minutes.trim()
      ? Math.max(15, Math.round(Number(maintForm.estimated_duration_minutes)))
      : null;

    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const initialStatus = maintForm.mark_vehicle_in_maintenance ? "in_progress" : "scheduled";
      await createMaintenanceRecord({
        vehicle_id: Number(maintForm.vehicle_id) || maintForm.vehicle_id,
        maintenance_type: maintForm.maintenance_type,
        scheduled_at: scheduledIso.toISOString(),
        estimated_duration_minutes: Number.isFinite(durationMin) ? durationMin : null,
        notes: maintForm.notes.trim() || null,
        status: initialStatus,
      });

      if (maintForm.mark_vehicle_in_maintenance) {
        await updateVehicle(String(maintForm.vehicle_id), { status: "maintenance" });
      }

      const v = vehicleById.get(String(maintForm.vehicle_id));
      setNotice(`Maintenance "${maintForm.maintenance_type}" ${initialStatus === "in_progress" ? "started" : "scheduled"} for ${v?.code || v?.label || "truck"}.`);
      setShowMaintModal(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save maintenance record.");
    } finally {
      setBusy(false);
    }
  };

  const handleMaintenanceTransition = async (record: MaintenanceRecord, nextStatus: "in_progress" | "completed" | "cancelled") => {
    if (!canManage) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await updateMaintenanceRecord(String(record.id), { status: nextStatus });
      const vehicle = vehicleById.get(String(record.vehicle_id));
      if (nextStatus === "in_progress") {
        await updateVehicle(String(record.vehicle_id), { status: "maintenance" });
      } else if ((nextStatus === "completed" || nextStatus === "cancelled") && vehicle && normalizeStatus(vehicle.status) === "maintenance") {
        await updateVehicle(String(record.vehicle_id), { status: "available" });
      }
      setNotice(`Maintenance "${record.maintenance_type}" marked ${nextStatus.replace("_", " ")}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to update maintenance record.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {!canManage && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs sm:text-sm text-blue-800">
          Read-only view: Only Administrators and Dispatchers can add trucks, change truck availability, or schedule maintenance.
        </div>
      )}

      {actionError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-2">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="p-1 text-red-700 hover:text-red-900" aria-label="Dismiss error">
            <X className="size-4" />
          </button>
        </div>
      )}

      {notice && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="p-1 text-emerald-700 hover:text-emerald-900" aria-label="Dismiss notice">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Fleet Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Registered Trucks</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums mt-1">{fleetCounts.total}</div>
          <div className="text-xs text-gray-600 mt-1">
            {fleetCounts.active} active ({fleetCounts.activeLiters > 0 ? `${formatVolumeDisplay(fleetCounts.activeLiters)} · ` : ""}{formatMassDisplay(fleetCounts.activeKg)})
          </div>
          {fleetCounts.totalKg > 0 && (
            <div className="text-[11px] text-gray-500 mt-0.5 tabular-nums">
              Fleet total: {fleetCounts.totalLiters > 0 ? `${formatVolumeDisplay(fleetCounts.totalLiters)} · ` : ""}{formatMassDisplay(fleetCounts.totalKg)}
            </div>
          )}
        </div>
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">In Maintenance</div>
          <div className="text-2xl sm:text-3xl font-bold text-amber-700 tabular-nums mt-1">{fleetCounts.inMaint}</div>
          <div className="text-xs text-amber-800 mt-1">Held off dispatch rotation</div>
        </div>
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Open Service Work</div>
          <div className="text-2xl sm:text-3xl font-bold text-blue-700 tabular-nums mt-1">{fleetCounts.openWork}</div>
          <div className="text-xs text-blue-700 mt-1">Scheduled or in progress</div>
        </div>
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Logs</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums mt-1">{maintenanceRecords.length}</div>
          <div className="text-xs text-gray-600 mt-1">Preventive &amp; repair records</div>
        </div>
      </div>

      {/* Fleet Registry */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
        <div className="p-4 sm:p-5 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Truck className="size-5 text-emerald-700" aria-hidden="true" />
            <div>
              <h3 className="font-semibold text-gray-900 text-base">Fleet Registry</h3>
              <p className="text-xs text-gray-500">Add, update, and manage SWMO collection vehicles.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none sm:min-w-[200px]">
              <Search className="size-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={vehicleSearch}
                onChange={(e) => setVehicleSearch(e.target.value)}
                placeholder="Search code, plate, model..."
                className="h-9 w-full pl-9 pr-3 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div className="w-40">
              <CustomSelect
                ariaLabel="Filter trucks by status"
                value={vehicleStatusFilter}
                onChange={setVehicleStatusFilter}
                options={[
                  { value: "ALL", label: "All Statuses" },
                  ...VEHICLE_STATUS_OPTIONS,
                  { value: "inactive", label: "Inactive" },
                ]}
              />
            </div>

            {canManage && (
              <button
                type="button"
                onClick={openAddVehicle}
                className="h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium inline-flex items-center gap-1.5"
              >
                <Plus className="size-4" aria-hidden="true" />
                <span>Add Truck</span>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Truck</th>
                <th className="px-4 py-3">Plate &amp; Model</th>
                <th className="px-4 py-3">Capacity</th>
                <th className="px-4 py-3">Assigned Driver</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredVehicles.map((vehicle) => {
                const badge = vehicleStatusBadge(vehicle);
                const code = vehicle.code || vehicle.truck_code || `TRK-${vehicle.id}`;
                const assignedDriverId = driverIdByVehicleId.get(String(vehicle.id)) || "";
                const driverName = driverNameByVehicleId.get(String(vehicle.id)) || "Unassigned";
                return (
                  <tr key={String(vehicle.id)} className="hover:bg-gray-50/70">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{vehicle.label || code}</div>
                      <div className="text-xs text-gray-500 font-mono">{code}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{vehicle.plate_number || "—"}</div>
                      <div className="text-xs text-gray-500">{vehicle.model || "No model specified"}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 tabular-nums">
                      <div>
                        {vehicle.capacity_kg != null ? formatMassDisplay(Number(vehicle.capacity_kg)) : "—"}
                        {vehicle.capacity_liters != null && Number(vehicle.capacity_liters) > 0 && (
                          <span className="text-xs text-gray-500 ml-1">
                            ({formatVolumeDisplay(Number(vehicle.capacity_liters))})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {canManage ? (
                        <div className="w-44">
                          <CustomSelect
                            size="sm"
                            ariaLabel={`Assign driver to ${vehicle.label || code}`}
                            value={assignedDriverId}
                            disabled={busy}
                            onChange={(nextDriverId) => void handleInlineDriverAssign(vehicle.id, nextDriverId)}
                            options={driverSelectOptions}
                          />
                        </div>
                      ) : (
                        driverName
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditVehicle(vehicle)}
                            className="px-2.5 py-1 rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1"
                          >
                            <Pencil className="size-3" aria-hidden="true" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setVehicleToToggle(vehicle)}
                            className={`px-2.5 py-1 rounded-md border text-xs font-medium inline-flex items-center gap-1 ${
                              vehicle.is_active === false
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                            }`}
                          >
                            {vehicle.is_active === false ? (
                              <>
                                <RotateCcw className="size-3" aria-hidden="true" />
                                <span>Activate</span>
                              </>
                            ) : (
                              <>
                                <Ban className="size-3" aria-hidden="true" />
                                <span>Deactivate</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setVehicleToDelete(vehicle)}
                            className="px-2 py-1 rounded-md border border-red-200 bg-white text-xs font-medium text-red-600 hover:bg-red-50 inline-flex items-center"
                            aria-label={`Delete ${vehicle.label || code}`}
                            title="Delete truck permanently"
                          >
                            <Trash2 className="size-3" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filteredVehicles.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="px-4 py-8 text-center text-gray-500">
                    No trucks match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Driver Management & Vehicle Assignment */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
        <div className="p-4 sm:p-5 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="size-5 text-emerald-700" aria-hidden="true" />
            <div>
              <h3 className="font-semibold text-gray-900 text-base">Driver Management &amp; Vehicle Assignment</h3>
              <p className="text-xs text-gray-500">
                Registered Truck Drivers ({activeDrivers.length} active) — available for vehicle and route assignment immediately upon registration.
              </p>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Connection Status</th>
                <th className="px-4 py-3">Availability &amp; Route</th>
                <th className="px-4 py-3">Assigned Truck</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activeDrivers.map((driver) => {
                const seenMs = driver.last_seen_at ? new Date(driver.last_seen_at).getTime() : 0;
                const isOnline =
                  seenMs > 0 &&
                  Date.now() - seenMs <= operationsConfig.driverOfflineSeconds * 1000 &&
                  normalizeStatus(driver.status) !== "offline";
                const assignedRoute = routes.find(
                  (r) => String(r.driver_id) === String(driver.id) && normalizeStatus(r.status) !== "completed",
                );
                const assignedVehicleId =
                  driver.assigned_vehicle_id != null
                    ? String(driver.assigned_vehicle_id)
                    : Array.from(driverIdByVehicleId.entries()).find(([, dId]) => dId === String(driver.id))?.[0] ?? "";
                const assignedVehicle = assignedVehicleId ? vehicleById.get(assignedVehicleId) : null;
                const driverStatusNorm = normalizeStatus(driver.status);
                const availabilityLabel =
                  driverStatusNorm === "on_route"
                    ? "On Route"
                    : assignedRoute || assignedVehicle
                      ? "Assigned"
                      : "Available";
                const availabilityCls =
                  driverStatusNorm === "on_route"
                    ? "bg-emerald-100 text-emerald-800"
                    : assignedRoute || assignedVehicle
                      ? "bg-blue-100 text-blue-800"
                      : "bg-gray-100 text-gray-800";

                return (
                  <tr key={String(driver.id)} className="hover:bg-gray-50/70">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{driver.name}</div>
                      <div className="text-xs text-gray-500">ID #{driver.id} • Active Driver</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {driver.phone || driver.phone_number || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
                        <span className={`size-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-gray-400"}`} />
                        <span>{isOnline ? "Online" : "Offline"}</span>
                      </span>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {driver.last_seen_at ? `Last seen ${formatDateTime(driver.last_seen_at)}` : "Not connected yet"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${availabilityCls}`}>
                        {availabilityLabel}
                      </span>
                      {assignedRoute && (
                        <div className="text-xs text-gray-600 mt-1 truncate max-w-[220px]">
                          Route: {assignedRoute.name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canManage ? (
                        <div className="w-52">
                          <CustomSelect
                            size="sm"
                            ariaLabel={`Assign truck to ${driver.name}`}
                            value={assignedVehicleId}
                            disabled={busy}
                            onChange={(nextVehId) =>
                              void handleDriverVehicleAssign(driver.id, assignedVehicleId || null, nextVehId)
                            }
                            options={[
                              { value: "", label: "Unassigned" },
                              ...vehicleSelectOptions,
                            ]}
                          />
                        </div>
                      ) : assignedVehicle ? (
                        `${assignedVehicle.code || `TRK-${assignedVehicle.id}`} — ${assignedVehicle.label || assignedVehicle.plate_number || "Truck"}`
                      ) : (
                        "Unassigned"
                      )}
                    </td>
                  </tr>
                );
              })}
              {activeDrivers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No active truck drivers registered.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Maintenance Schedule & Service Logs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
        <div className="p-4 sm:p-5 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Wrench className="size-5 text-amber-700" aria-hidden="true" />
            <div>
              <h3 className="font-semibold text-gray-900 text-base">Maintenance Schedule &amp; Logs</h3>
              <p className="text-xs text-gray-500">Track scheduled inspections, repairs, and downtime per truck.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="w-48">
              <CustomSelect
                ariaLabel="Filter maintenance by truck"
                value={maintVehicleFilter}
                onChange={setMaintVehicleFilter}
                options={[{ value: "ALL", label: "All Trucks" }, ...vehicleSelectOptions]}
              />
            </div>

            <div className="w-40">
              <CustomSelect
                ariaLabel="Filter maintenance by status"
                value={maintStatusFilter}
                onChange={setMaintStatusFilter}
                options={MAINTENANCE_STATUS_FILTER_OPTIONS}
              />
            </div>

            {canManage && (
              <button
                type="button"
                onClick={openScheduleMaintenance}
                disabled={availableMaintenanceTruckOptions.length === 0}
                title={availableMaintenanceTruckOptions.length === 0 ? "No available trucks to schedule for maintenance" : undefined}
                className="h-9 px-3.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-1.5"
              >
                <CalendarClock className="size-4" aria-hidden="true" />
                <span>Schedule Maintenance</span>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Truck</th>
                <th className="px-4 py-3">Service Type</th>
                <th className="px-4 py-3">Scheduled</th>
                <th className="px-4 py-3">Duration / Notes</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredMaintenance.map((rec) => {
                const v = vehicleById.get(String(rec.vehicle_id));
                const badge = maintenanceStatusBadge(rec.status);
                const sNorm = normalizeStatus(rec.status);
                return (
                  <tr key={String(rec.id)} className="hover:bg-gray-50/70">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">
                        {v ? v.label || v.code || `Truck #${v.id}` : `Truck #${rec.vehicle_id}`}
                      </div>
                      {v?.plate_number && <div className="text-xs text-gray-500">{v.plate_number}</div>}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800">{rec.maintenance_type}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDateTime(rec.scheduled_at)}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs">
                      <div className="text-xs font-medium text-gray-800">
                        {rec.estimated_duration_minutes ? `${rec.estimated_duration_minutes} mins est.` : "Duration N/A"}
                      </div>
                      {rec.notes && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{rec.notes}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {sNorm === "scheduled" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleMaintenanceTransition(rec, "in_progress")}
                              className="px-2.5 py-1 rounded-md border border-amber-200 bg-amber-50 text-xs font-medium text-amber-800 hover:bg-amber-100"
                            >
                              Start
                            </button>
                          )}
                          {(sNorm === "scheduled" || sNorm === "in_progress") && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleMaintenanceTransition(rec, "completed")}
                                className="px-2.5 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-xs font-medium text-emerald-800 hover:bg-emerald-100 inline-flex items-center gap-1"
                              >
                                <CheckCircle2 className="size-3" aria-hidden="true" />
                                <span>Complete</span>
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleMaintenanceTransition(rec, "cancelled")}
                                className="px-2.5 py-1 rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1"
                              >
                                <XCircle className="size-3" aria-hidden="true" />
                                <span>Cancel</span>
                              </button>
                            </>
                          )}
                          {(sNorm === "completed" || sNorm === "cancelled") && (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filteredMaintenance.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="px-4 py-8 text-center text-gray-500">
                    No maintenance records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Truck Modal */}
      {showVehicleModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={editingVehicle ? "Edit Truck" : "Add Truck"}>
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-200 pb-3">
              <h3 className="text-lg font-bold text-gray-900">{editingVehicle ? "Edit Truck Details" : "Add Collection Truck"}</h3>
              <button type="button" onClick={() => setShowVehicleModal(false)} className="p-1 text-gray-500 hover:text-gray-800 rounded-lg" aria-label="Close modal">
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={handleSaveVehicle} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Truck Code *</label>
                  <input
                    type="text"
                    required
                    value={vehicleForm.code}
                    onChange={(e) => setVehicleForm((p) => ({ ...p, code: e.target.value }))}
                    placeholder="e.g. TRK-08"
                    className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Plate Number *</label>
                  <input
                    type="text"
                    required
                    value={vehicleForm.plate_number}
                    onChange={(e) => setVehicleForm((p) => ({ ...p, plate_number: e.target.value }))}
                    placeholder="e.g. NGA-4021"
                    className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Display Name / Label *</label>
                <input
                  type="text"
                  required
                  value={vehicleForm.label}
                  onChange={(e) => setVehicleForm((p) => ({ ...p, label: e.target.value }))}
                  placeholder="e.g. Compactor Unit 8"
                  className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Model</label>
                  <input
                    type="text"
                    value={vehicleForm.model}
                    onChange={(e) => setVehicleForm((p) => ({ ...p, model: e.target.value }))}
                    placeholder="Hino 500 Series"
                    className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Volume (m³)</label>
                  <input
                    type="number"
                    min="0.1"
                    step="any"
                    value={vehicleForm.capacity_m3}
                    onChange={(e) => {
                      const val = e.target.value;
                      const num = Number(val);
                      setVehicleForm((p) => ({
                        ...p,
                        capacity_m3: val,
                        capacity_kg:
                          val.trim() && Number.isFinite(num) && num > 0
                            ? String(Math.round(num * 294 * 10) / 10)
                            : p.capacity_kg,
                      }));
                    }}
                    placeholder="10"
                    className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Weight (kg @ 294 kg/m³)</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={vehicleForm.capacity_kg}
                    onChange={(e) => setVehicleForm((p) => ({ ...p, capacity_kg: e.target.value }))}
                    placeholder="2940"
                    className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Operational Status</label>
                  <CustomSelect
                    ariaLabel="Truck operational status"
                    value={vehicleForm.status}
                    onChange={(val) => setVehicleForm((p) => ({ ...p, status: val }))}
                    options={VEHICLE_STATUS_OPTIONS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Assigned Driver</label>
                  <CustomSelect
                    ariaLabel="Assigned driver"
                    value={vehicleForm.driver_id}
                    onChange={(val) => setVehicleForm((p) => ({ ...p, driver_id: val }))}
                    options={driverSelectOptions}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowVehicleModal(false)}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold"
                >
                  {busy ? "Saving…" : editingVehicle ? "Save Changes" : "Add Truck"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Schedule Maintenance Modal */}
      {showMaintModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Schedule Maintenance">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-200 pb-3">
              <h3 className="text-lg font-bold text-gray-900">Schedule Truck Maintenance</h3>
              <button type="button" onClick={() => setShowMaintModal(false)} className="p-1 text-gray-500 hover:text-gray-800 rounded-lg" aria-label="Close modal">
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMaintenance} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Truck *</label>
                <CustomSelect
                  ariaLabel="Select truck for maintenance"
                  value={maintForm.vehicle_id}
                  onChange={(val) => setMaintForm((p) => ({ ...p, vehicle_id: val }))}
                  options={availableMaintenanceTruckOptions}
                  placeholder="No available trucks"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Maintenance Type *</label>
                <CustomSelect
                  ariaLabel="Select maintenance type"
                  value={maintForm.maintenance_type}
                  onChange={(val) => setMaintForm((p) => ({ ...p, maintenance_type: val }))}
                  options={maintenanceTypeOptions}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Scheduled Date &amp; Time *</label>
                  <input
                    type="datetime-local"
                    required
                    value={maintForm.scheduled_at}
                    onChange={(e) => setMaintForm((p) => ({ ...p, scheduled_at: e.target.value }))}
                    className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Estimated Duration (mins)</label>
                  <input
                    type="number"
                    min="15"
                    step="15"
                    value={maintForm.estimated_duration_minutes}
                    onChange={(e) => setMaintForm((p) => ({ ...p, estimated_duration_minutes: e.target.value }))}
                    className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Work Notes</label>
                <textarea
                  rows={3}
                  value={maintForm.notes}
                  onChange={(e) => setMaintForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Describe brake check, hydraulic inspection, parts needed..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={maintForm.mark_vehicle_in_maintenance}
                  onChange={(e) => setMaintForm((p) => ({ ...p, mark_vehicle_in_maintenance: e.target.checked }))}
                  className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-600"
                />
                <span>Start immediately and mark truck status as &ldquo;In Maintenance&rdquo;</span>
              </label>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMaintModal(false)}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-semibold"
                >
                  {busy ? "Saving…" : "Save Schedule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deactivate / Activate Confirmation */}
      <ConfirmModal
        isOpen={Boolean(vehicleToToggle)}
        onClose={() => setVehicleToToggle(null)}
        onConfirm={handleConfirmToggleVehicleActive}
        title={vehicleToToggle?.is_active === false ? "Activate Truck" : "Deactivate Truck"}
        message={
          vehicleToToggle?.is_active === false
            ? `Reactivate ${vehicleToToggle.code || vehicleToToggle.label} so it appears available for route assignments?`
            : `Deactivate ${vehicleToToggle?.code || vehicleToToggle?.label}? Inactive trucks will no longer be dispatched to new routes.`
        }
        confirmText={vehicleToToggle?.is_active === false ? "Activate" : "Deactivate"}
        variant={vehicleToToggle?.is_active === false ? "info" : "danger"}
      />

      {/* Delete Vehicle Confirmation */}
      <ConfirmModal
        isOpen={Boolean(vehicleToDelete)}
        onClose={() => setVehicleToDelete(null)}
        onConfirm={handleConfirmDeleteVehicle}
        title="Delete Truck"
        message={`Permanently remove ${vehicleToDelete?.code || vehicleToDelete?.label}? Any driver assignment on this truck will be cleared, and linked routes will keep history with an unassigned truck.`}
        confirmText="Delete Truck"
        variant="danger"
      />
    </div>
  );
}
