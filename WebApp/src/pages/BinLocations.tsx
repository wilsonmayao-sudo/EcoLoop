import { useMemo, useState } from "react";
import { MapPin, Plus, X, Navigation, Pencil, Trash2 } from "lucide-react";
import NotificationDropdown from "../components/feedback/NotificationDropdown";
import RoleIndicator from "../components/layout/RoleIndicator";
import ConfirmModal from "../components/feedback/ConfirmModal";
import { formatDateOnly, useLiveData, type BinRecord } from "../hooks/useLiveData";

type PageType = "dashboard" | "route-planning" | "vehicle-monitoring" | "reports" | "bin-locations" | "notifications";

interface BinLocationsProps {
  onNavigate?: (page: PageType) => void;
}

const emptyBinForm = { code: "", location: "", type: "", lat: "", lng: "", capacity: "" };

export default function BinLocations({ onNavigate }: BinLocationsProps) {
  const { bins, binTypes, loading, error, createBin, updateBin, deleteBin } = useLiveData();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedBin, setSelectedBin] = useState<BinRecord | null>(null);
  const [showMapModal, setShowMapModal] = useState(false);
  const [showMoveLocationModal, setShowMoveLocationModal] = useState(false);
  const [binToMove, setBinToMove] = useState<BinRecord | null>(null);
  const [binToDelete, setBinToDelete] = useState<BinRecord | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [newBin, setNewBin] = useState(emptyBinForm);
  const [moveForm, setMoveForm] = useState({ location: "", lat: "", lng: "" });

  const activeBinTypes = binTypes.map((type) => type.name);
  const typeCounts = useMemo(
    () =>
      activeBinTypes.reduce<Record<string, number>>((acc, type) => {
        acc[type] = bins.filter((bin) => bin.type === type).length;
        return acc;
      }, {}),
    [activeBinTypes, bins],
  );

  const parseCoordinates = (latValue: string, lngValue: string) => {
    const latitude = Number(latValue);
    const longitude = Number(lngValue);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("Latitude and longitude must be valid numbers.");
    }
    return { latitude, longitude };
  };

  const handleAddBin = async () => {
    try {
      setFormError(null);
      if (!newBin.code.trim() || !newBin.location.trim() || !newBin.type) {
        setFormError("Code, location, and type are required.");
        return;
      }
      const coordinates = parseCoordinates(newBin.lat, newBin.lng);
      await createBin({
        code: newBin.code.trim(),
        location: newBin.location.trim(),
        type: newBin.type,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        status: "active",
        capacity_percent: newBin.capacity ? Number(newBin.capacity) : null,
      });
      setNewBin(emptyBinForm);
      setShowAddModal(false);
    } catch (err: any) {
      setFormError(err?.message ?? "Unable to add bin.");
    }
  };

  const handleMoveBin = async () => {
    if (!binToMove) return;
    try {
      setFormError(null);
      const coordinates = parseCoordinates(moveForm.lat, moveForm.lng);
      await updateBin(binToMove.id, {
        location: moveForm.location.trim() || binToMove.location,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      });
      setShowMoveLocationModal(false);
      setBinToMove(null);
    } catch (err: any) {
      setFormError(err?.message ?? "Unable to move bin.");
    }
  };

  const handleViewMap = (bin: BinRecord) => {
    setSelectedBin(bin);
    setShowMapModal(true);
  };

  const getTypeColor = (type?: string | null) => {
    switch (type) {
      case "residential":
        return "bg-blue-100 text-blue-700";
      case "commercial":
        return "bg-purple-100 text-purple-700";
      case "industrial":
        return "bg-amber-100 text-amber-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">
      <div className="space-y-6">
        <RoleIndicator />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-gray-900">Bin Locations</h2>
            <p className="text-gray-600">Naga City Waste Collection Management</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm text-gray-900">Today</div>
              <div className="text-xs text-gray-500">{formatDateOnly(new Date().toISOString())}</div>
            </div>
            {onNavigate && <NotificationDropdown onViewAll={() => onNavigate("notifications")} />}
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">Total Bins</div>
            <div className="text-gray-900 mt-2">{loading ? "..." : bins.length}</div>
            <div className="text-blue-500 text-sm mt-1">Database records</div>
          </div>
          {activeBinTypes.slice(0, 3).map((type) => (
            <div key={type} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-gray-600 text-sm capitalize">{type}</div>
              <div className="text-gray-900 mt-2">{loading ? "..." : typeCounts[type] ?? 0}</div>
              <div className="text-blue-500 text-sm mt-1">Bin locations</div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-gray-900">All Bin Locations</h3>
            <p className="text-sm text-gray-600">Manage collection sites and bin status across the city.</p>
          </div>
          <button
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all shadow-md hover:shadow-lg"
            onClick={() => setShowAddModal(true)}
          >
            <Plus className="size-5" />
            <span>Add Location</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bins.map((bin) => {
            const latitude = Number(bin.latitude);
            const longitude = Number(bin.longitude);
            return (
              <div key={bin.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md transition-all">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-emerald-50">
                      <MapPin className="size-5 text-emerald-700" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-gray-900">{bin.code ?? bin.id}</h3>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs mt-1 capitalize ${getTypeColor(bin.type)}`}>
                        {bin.type ?? "untyped"}
                      </span>
                    </div>
                  </div>
                  <button className="p-1 text-red-600 hover:bg-red-50 rounded" onClick={() => setBinToDelete(bin)} title="Delete bin">
                    <Trash2 className="size-4" />
                  </button>
                </div>

                <div className="flex items-start gap-2 mb-4">
                  <MapPin className="size-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-gray-900">{bin.location}</div>
                </div>

                {Number.isFinite(latitude) && Number.isFinite(longitude) && (
                  <div className="text-xs text-gray-500 border-t border-gray-200 pt-3 font-mono">
                    {latitude.toFixed(5)}, {longitude.toFixed(5)}
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <button
                    className="px-3 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors flex items-center justify-center gap-1.5"
                    onClick={() => {
                      setBinToMove(bin);
                      setMoveForm({
                        location: bin.location,
                        lat: String(bin.latitude ?? ""),
                        lng: String(bin.longitude ?? ""),
                      });
                      setFormError(null);
                      setShowMoveLocationModal(true);
                    }}
                    title="Move bin to new location"
                  >
                    <Navigation className="size-3.5" />
                    <span>Move</span>
                  </button>
                  <button className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors" onClick={() => handleViewMap(bin)}>
                    View Map
                  </button>
                </div>
              </div>
            );
          })}
          {!loading && bins.length === 0 && (
            <div className="col-span-full rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
              No collection sites found yet.
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]" onClick={() => setShowAddModal(false)}>
          <div className="bg-white p-6 rounded-lg shadow-lg w-96" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-gray-900 mb-4">Add Bin Location</h3>
            <div className="space-y-4">
              <input value={newBin.code} onChange={(event) => setNewBin({ ...newBin, code: event.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Bin code" />
              <input value={newBin.location} onChange={(event) => setNewBin({ ...newBin, location: event.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Location" />
              <select value={newBin.type} onChange={(event) => setNewBin({ ...newBin, type: event.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">Select type</option>
                {activeBinTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <input value={newBin.lat} onChange={(event) => setNewBin({ ...newBin, lat: event.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Latitude" />
              <input value={newBin.lng} onChange={(event) => setNewBin({ ...newBin, lng: event.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Longitude" />
              <input value={newBin.capacity} onChange={(event) => setNewBin({ ...newBin, capacity: event.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Capacity percent (optional)" />
              {formError && <p className="text-sm text-red-600">{formError}</p>}
            </div>
            <div className="flex gap-3 mt-6">
              <button className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700" onClick={() => void handleAddBin()}>
                Add Bin
              </button>
            </div>
          </div>
        </div>
      )}

      {showMapModal && selectedBin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300] p-4" onClick={() => setShowMapModal(false)}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-emerald-50 to-blue-50">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-green-100">
                  <MapPin className="size-6 text-green-600" />
                </div>
                <div>
                  <h3 className="text-gray-900">{selectedBin.code ?? selectedBin.id}</h3>
                  <p className="text-sm text-gray-600">{selectedBin.location}</p>
                </div>
              </div>
              <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-white/50 rounded-lg" onClick={() => setShowMapModal(false)}>
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
              <div className="flex-1 bg-gray-100 relative">
                <iframe
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(selectedBin.longitude) - 0.01},${Number(selectedBin.latitude) - 0.01},${Number(selectedBin.longitude) + 0.01},${Number(selectedBin.latitude) + 0.01}&layer=mapnik&marker=${Number(selectedBin.latitude)},${Number(selectedBin.longitude)}`}
                  title={`Map location for ${selectedBin.code ?? selectedBin.id}`}
                />
              </div>
              <div className="w-full md:w-[400px] bg-white border-t md:border-t-0 md:border-l border-gray-200 flex flex-col overflow-y-auto">
                <div className="p-6 border-b border-gray-200 bg-gray-50">
                  <div className="text-sm text-gray-600 mb-3">Location Details</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Type</span>
                      <span className={`px-2 py-1 rounded-full text-xs capitalize ${getTypeColor(selectedBin.type)}`}>{selectedBin.type ?? "untyped"}</span>
                    </div>
                    <div>
                      <div className="text-gray-600 text-xs">Address/Place</div>
                      <div className="text-gray-900">{selectedBin.location}</div>
                    </div>
                  </div>
                </div>
                <div className="p-6 space-y-4">
                  <div className="text-sm text-gray-700 flex items-center gap-2">
                    <Pencil className="size-4 text-gray-400" />
                    Use Move to save a new location for this site.
                  </div>
                  <button
                    onClick={() => window.open(`https://www.google.com/maps?q=${Number(selectedBin.latitude)},${Number(selectedBin.longitude)}`, "_blank")}
                    className="w-full px-4 py-2.5 border border-gray-300 bg-white text-gray-700 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2"
                  >
                    <MapPin className="size-4" />
                    Open in Google Maps
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showMoveLocationModal && binToMove && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]" onClick={() => setShowMoveLocationModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Navigation className="size-6 text-orange-600" />
                </div>
                <div>
                  <h3 className="font-['Poppins:SemiBold',sans-serif] text-gray-900">Move Bin Location</h3>
                  <p className="font-['Poppins:Regular',sans-serif] text-sm text-gray-600">Relocate {binToMove.code ?? binToMove.id}</p>
                </div>
              </div>
              <button onClick={() => setShowMoveLocationModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="size-6" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <input value={moveForm.location} onChange={(event) => setMoveForm((prev) => ({ ...prev, location: event.target.value }))} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg" placeholder="New location address" />
              <div className="grid grid-cols-2 gap-4">
                <input value={moveForm.lat} onChange={(event) => setMoveForm((prev) => ({ ...prev, lat: event.target.value }))} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg" placeholder="Latitude" />
                <input value={moveForm.lng} onChange={(event) => setMoveForm((prev) => ({ ...prev, lng: event.target.value }))} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg" placeholder="Longitude" />
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
            </div>
            <div className="flex gap-3 p-6 border-t border-gray-200">
              <button onClick={() => setShowMoveLocationModal(false)} className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => void handleMoveBin()} className="flex-1 px-4 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700">
                Confirm Move
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(binToDelete)}
        onClose={() => setBinToDelete(null)}
        onConfirm={async () => {
          if (!binToDelete) return;
          await deleteBin(binToDelete.id);
        }}
        title="Delete Bin"
        message="Delete this collection site? This cannot be undone."
        variant="danger"
        confirmText="Delete"
      />
    </div>
  );
}
