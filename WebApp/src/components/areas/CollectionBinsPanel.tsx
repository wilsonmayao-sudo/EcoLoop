import React, { useEffect, useMemo, useState } from "react";
import { MapPin, Plus, X, Navigation, Pencil, Ban, RotateCcw } from "lucide-react";
import ConfirmModal from "../feedback/ConfirmModal";
import { isBinActive, useLiveData, type BinRecord } from "../../hooks/useLiveData";
import BinLocationPicker from "../maps/BinLocationPicker";
import CustomSelect from "../ui/CustomSelect";
import {
  doesAreaMatchScheduleDay,
  doesBinMatchScheduleDay,
  getEffectiveBinScheduleDays,
  SCHEDULE_DAY_CODES,
} from "../../utils/scheduleDays";
import { formatCollectionAreaDisplay } from "../../utils/areaDisplay";

interface CollectionBinsPanelProps {
  areaFilterOverride?: string | null;
}

const NAGA_CITY_COORDINATE = { latitude: 13.6218, longitude: 123.1948 };
const DAYS_OF_WEEK = SCHEDULE_DAY_CODES;
const emptyBinForm = {
  code: "",
  location: "",
  barangay: "",
  area_code: "",
  type: "",
  lat: String(NAGA_CITY_COORDINATE.latitude),
  lng: String(NAGA_CITY_COORDINATE.longitude),
};
const DEFAULT_BIN_TYPE = "collection_site";

export default function CollectionBinsPanel({ areaFilterOverride }: CollectionBinsPanelProps) {
  const { bins, binTypes, collectionSchedules, loading, error, createBin, updateBin, disableBin, enableBin } = useLiveData();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedBin, setSelectedBin] = useState(null as BinRecord | null);
  const [showMapModal, setShowMapModal] = useState(false);
  const [showMoveLocationModal, setShowMoveLocationModal] = useState(false);
  const [binToMove, setBinToMove] = useState(null as BinRecord | null);
  const [binToToggle, setBinToToggle] = useState(null as BinRecord | null);
  const [formError, setFormError] = useState(null as string | null);
  const [newBin, setNewBin] = useState(emptyBinForm);
  const [moveForm, setMoveForm] = useState({ location: "", barangay: "", area_code: "", lat: "", lng: "" });
  const [filterBarangay, setFilterBarangay] = useState("ALL");
  const [filterArea, setFilterArea] = useState(areaFilterOverride || "ALL");
  const [filterDay, setFilterDay] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "ACTIVE" | "DISABLED">("ALL");

  useEffect(() => {
    if (areaFilterOverride) {
      setFilterArea(areaFilterOverride);
    }
  }, [areaFilterOverride]);

  const activeBinTypes = useMemo(() => binTypes.map((type) => type?.name).filter((name): name is string => Boolean(name)), [binTypes]);

  const barangayOptions = useMemo(() => {
    const set = new Set<string>();
    bins.forEach((b) => {
      if (b.barangay?.trim()) set.add(b.barangay.trim());
    });
    collectionSchedules.forEach((s) => {
      if (s.stop_type !== "disposal" && s.barangay?.trim()) set.add(s.barangay.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [bins, collectionSchedules]);

  const areaOptions = useMemo(() => {
    const schedulesByArea = new Map<
      string,
      { rawName: string | null; rows: Array<{ days_of_week: string[]; is_active: boolean }> }
    >();
    collectionSchedules.forEach((s) => {
      const code = s.area_code?.trim();
      if (!code) return;
      const entry = schedulesByArea.get(code) ?? { rawName: s.area_name ?? null, rows: [] };
      if (!entry.rawName && s.area_name) entry.rawName = s.area_name;
      entry.rows.push({ days_of_week: s.days_of_week ?? [], is_active: s.is_active !== false });
      schedulesByArea.set(code, entry);
    });
    bins.forEach((b) => {
      const code = b.area_code?.trim();
      if (code && !schedulesByArea.has(code)) {
        schedulesByArea.set(code, { rawName: null, rows: [] });
      }
    });

    return Array.from(schedulesByArea.entries())
      .filter(([, meta]) => filterDay === "ALL" || meta.rows.length === 0 || doesAreaMatchScheduleDay(meta.rows, filterDay))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([code, meta]) => ({
        value: code,
        label: formatCollectionAreaDisplay(code, meta.rawName, meta.rows),
      }));
  }, [bins, collectionSchedules, filterDay]);

  const filteredBins = useMemo(() => {
    return bins.filter((bin) => {
      const active = isBinActive(bin);
      if (filterStatus === "ACTIVE" && !active) return false;
      if (filterStatus === "DISABLED" && active) return false;
      if (filterBarangay !== "ALL" && (bin.barangay ?? "") !== filterBarangay) return false;
      if (filterArea !== "ALL" && (bin.area_code ?? "") !== filterArea) return false;
      if (filterDay !== "ALL" && !doesBinMatchScheduleDay(bin, filterDay, collectionSchedules)) return false;
      return true;
    });
  }, [bins, collectionSchedules, filterArea, filterBarangay, filterDay, filterStatus]);

  const parseCoordinates = (latValue: string, lngValue: string) => {
    if (!latValue.trim() || !lngValue.trim()) {
      throw new Error("Select a location on the map or enter latitude and longitude.");
    }
    const latitude = Number(latValue);
    const longitude = Number(lngValue);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("Latitude and longitude must be valid numbers.");
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error("Latitude must be between -90 and 90, and longitude between -180 and 180.");
    }
    return { latitude, longitude };
  };

  const formatCoordinate = (value: number) => value.toFixed(6);
  const coordinateValue = (value: string) => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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

  const handleAddBin = async () => {
    try {
      setFormError(null);
      if (!newBin.code.trim() || !newBin.location.trim()) {
        setFormError("Code and location are required.");
        return;
      }
      const normalizedCode = newBin.code.trim().toLowerCase();
      const duplicateCode = bins.some((bin) => (bin.code ?? "").trim().toLowerCase() === normalizedCode);
      if (duplicateCode) {
        setFormError("Bin code already exists.");
        return;
      }
      const coordinates = parseCoordinates(newBin.lat, newBin.lng);
      await createBin({
        code: newBin.code.trim(),
        location: newBin.location.trim(),
        barangay: newBin.barangay.trim() || null,
        area_code: newBin.area_code.trim() || null,
        coordinate_status: "verified",
        collection_status: "pending",
        type: newBin.type || DEFAULT_BIN_TYPE,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        status: "active",
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
        barangay: moveForm.barangay.trim() || binToMove.barangay || null,
        area_code: moveForm.area_code.trim() || binToMove.area_code || null,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        coordinate_status: "verified",
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

  useEffect(() => {
    const anyModalOpen = showAddModal || showMapModal || showMoveLocationModal;
    if (!anyModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowAddModal(false);
        setShowMapModal(false);
        setShowMoveLocationModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAddModal, showMapModal, showMoveLocationModal]);

  return (
    <>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">All Collection Bin Locations ({filteredBins.length})</h2>
            <p className="text-xs sm:text-sm text-gray-600">Filter by status, barangay, SWMO area, or collection day.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CustomSelect
              value={filterStatus}
              onChange={(val) => setFilterStatus(val as "ALL" | "ACTIVE" | "DISABLED")}
              options={[
                { value: "ALL", label: "All Statuses" },
                { value: "ACTIVE", label: "Active Only" },
                { value: "DISABLED", label: "Disabled Only" },
              ]}
              className="min-w-[140px]"
              ariaLabel="Filter by bin status"
            />
            <CustomSelect
              value={filterBarangay}
              onChange={setFilterBarangay}
              options={[
                { value: "ALL", label: "All Barangays" },
                ...barangayOptions.map((brgy) => ({ value: brgy, label: brgy })),
              ]}
              className="min-w-[165px]"
              ariaLabel="Filter by barangay"
            />
            <CustomSelect
              value={filterArea}
              onChange={setFilterArea}
              options={[{ value: "ALL", label: "All SWMO Areas" }, ...areaOptions]}
              className="min-w-[230px]"
              ariaLabel="Filter by SWMO Area"
            />
            <CustomSelect
              value={filterDay}
              onChange={setFilterDay}
              options={[
                { value: "ALL", label: "All Days" },
                ...DAYS_OF_WEEK.map((day) => ({ value: day, label: day })),
              ]}
              className="min-w-[120px]"
              ariaLabel="Filter by collection day"
            />
            <button
              type="button"
              className="inline-flex min-h-[40px] items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              onClick={() => {
                setNewBin(emptyBinForm);
                setFormError(null);
                setShowAddModal(true);
              }}
            >
              <Plus className="size-5" />
              <span>Add Location</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBins.map((bin) => {
            const latitude = Number(bin.latitude);
            const longitude = Number(bin.longitude);
            const needsVerification = bin.coordinate_status === "needs_verification";
            const collectionStatus = (bin.collection_status ?? "pending").replace(/^'+|'+$/g, "");
            const active = isBinActive(bin);
            return (
              <div
                key={bin.id}
                className={`rounded-lg shadow-sm border p-5 transition-all ${
                  active
                    ? "bg-white border-gray-200 hover:shadow-md"
                    : "bg-gray-50/90 border-gray-300 opacity-85"
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${active ? "bg-emerald-50" : "bg-gray-200"}`}>
                      <MapPin className={`size-5 ${active ? "text-emerald-700" : "text-gray-500"}`} />
                    </div>
                    <div className="flex-1">
                      <h3 className={active ? "text-gray-900" : "text-gray-600"}>{bin.code ?? bin.id}</h3>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs capitalize ${getTypeColor(bin.type)}`}>
                          {bin.type ?? "collection_site"}
                        </span>
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                            active ? "bg-emerald-50 text-emerald-700" : "bg-red-100 text-red-800"
                          }`}
                        >
                          {active ? "Active" : "Disabled"}
                        </span>
                        {bin.area_code && (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                            {bin.area_code}
                          </span>
                        )}
                        {needsVerification && (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                            Needs GPS Verification
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border flex items-center gap-1 transition-colors ${
                      active
                        ? "text-amber-800 bg-amber-50 border-amber-200 hover:bg-amber-100"
                        : "text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                    }`}
                    onClick={() => setBinToToggle(bin)}
                    title={active ? "Disable bin (preserve record & history)" : "Re-enable bin for active routing"}
                  >
                    {active ? (
                      <>
                        <Ban className="size-3.5" />
                        <span>Disable Bin</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="size-3.5" />
                        <span>Re-enable</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex items-start gap-2 mb-3">
                  <MapPin className="size-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm text-gray-900">{bin.location}</div>
                    {bin.barangay && <div className="text-xs text-gray-500 mt-0.5">Brgy. {bin.barangay}</div>}
                  </div>
                </div>

                {(() => {
                  const effectiveDays = getEffectiveBinScheduleDays(bin, collectionSchedules);
                  if (!bin.schedule_time_window && effectiveDays.length === 0) return null;
                  return (
                    <div className="mb-3 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-xs text-gray-600 space-y-1">
                      {bin.schedule_time_window && (
                        <div>
                          <span className="font-medium text-gray-700">Schedule: </span>
                          {bin.schedule_time_window}
                        </div>
                      )}
                      {effectiveDays.length > 0 && (
                        <div>
                          <span className="font-medium text-gray-700">Days: </span>
                          {effectiveDays.length === 7 ? "Daily (Mon–Sun)" : effectiveDays.join(", ")}
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <span className="font-medium text-gray-700">Collection:</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${
                            collectionStatus === "completed"
                              ? "bg-emerald-100 text-emerald-700"
                              : collectionStatus === "missed"
                                ? "bg-red-100 text-red-700"
                                : collectionStatus === "en_route"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {collectionStatus.replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {Number.isFinite(latitude) && Number.isFinite(longitude) && (
                  <div className="text-xs text-gray-500 border-t border-gray-200 pt-3 font-mono flex items-center justify-between">
                    <span>
                      {latitude.toFixed(5)}, {longitude.toFixed(5)}
                    </span>
                    <span className={needsVerification ? "text-amber-700 font-sans" : "text-emerald-700 font-sans"}>
                      {needsVerification ? "Estimated / Verify" : "Verified"}
                    </span>
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <button
                    className="px-3 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors flex items-center justify-center gap-1.5"
                    onClick={() => {
                      setBinToMove(bin);
                      setMoveForm({
                        location: bin.location,
                        barangay: bin.barangay ?? "",
                        area_code: bin.area_code ?? "",
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
          {!loading && filteredBins.length === 0 && (
            <div className="col-span-full rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
              No collection sites match the selected filters.
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300] p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-gray-900 mb-1">Add Bin Location</h3>
            <p className="text-sm text-gray-600 mb-4">Pin the exact GPS point used by routing and driver navigation.</p>
            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
              <div className="space-y-4">
                <input value={newBin.code} onChange={(event) => setNewBin({ ...newBin, code: event.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Bin code (e.g. BIN-013)" />
                <input value={newBin.location} onChange={(event) => setNewBin({ ...newBin, location: event.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Location name or address" />
                <div className="grid grid-cols-2 gap-3">
                  <CustomSelect
                    value={newBin.barangay}
                    onChange={(barangay) => setNewBin({ ...newBin, barangay })}
                    options={[
                      { value: "", label: "Barangay (Optional)" },
                      ...barangayOptions.map((brgy) => ({ value: brgy, label: brgy })),
                    ]}
                    ariaLabel="Barangay"
                  />
                  <CustomSelect
                    value={newBin.area_code}
                    onChange={(area_code) => setNewBin({ ...newBin, area_code })}
                    options={[{ value: "", label: "SWMO Area (Optional)" }, ...areaOptions]}
                    ariaLabel="SWMO Area"
                  />
                </div>
                <CustomSelect
                  value={newBin.type}
                  onChange={(type) => setNewBin({ ...newBin, type })}
                  options={activeBinTypes.map((type) => ({ value: type, label: type }))}
                  placeholder="Select type"
                  buttonClassName="capitalize"
                  menuClassName="capitalize"
                  ariaLabel="Bin type"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" step="any" value={newBin.lat} onChange={(event) => setNewBin({ ...newBin, lat: event.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Latitude" />
                  <input type="number" step="any" value={newBin.lng} onChange={(event) => setNewBin({ ...newBin, lng: event.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Longitude" />
                </div>
                <p className="text-xs text-gray-500">Coordinates update automatically when you click or drag the pin. Manual coordinate edits move the pin in real time.</p>
                {formError && <p className="text-sm text-red-600">{formError}</p>}
              </div>
              <BinLocationPicker
                latitude={coordinateValue(newBin.lat)}
                longitude={coordinateValue(newBin.lng)}
                onChange={({ latitude, longitude }) =>
                  setNewBin((prev) => ({ ...prev, lat: formatCoordinate(latitude), lng: formatCoordinate(longitude) }))
                }
                className="h-[380px] w-full"
              />
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
                <BinLocationPicker
                  latitude={Number(selectedBin.latitude)}
                  longitude={Number(selectedBin.longitude)}
                  readOnly
                  className="absolute inset-0 h-full w-full rounded-none border-0"
                />
              </div>
              <div className="w-full md:w-[400px] bg-white border-t md:border-t-0 md:border-l border-gray-200 flex flex-col overflow-y-auto">
                <div className="p-6 border-b border-gray-200 bg-gray-50">
                  <div className="text-sm text-gray-600 mb-3">Location Details</div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <div className="text-gray-600 text-xs">Address/Place</div>
                      <div className="text-gray-900">{selectedBin.location}</div>
                    </div>
                    {selectedBin.barangay && (
                      <div>
                        <div className="text-gray-600 text-xs">Barangay</div>
                        <div className="text-gray-900">{selectedBin.barangay}</div>
                      </div>
                    )}
                    {selectedBin.area_code && (
                      <div>
                        <div className="text-gray-600 text-xs">SWMO Collection Area</div>
                        <div className="text-gray-900">{selectedBin.area_code}</div>
                      </div>
                    )}
                    {selectedBin.schedule_time_window && (
                      <div>
                        <div className="text-gray-600 text-xs">Schedule Time Window</div>
                        <div className="text-gray-900">{selectedBin.schedule_time_window}</div>
                      </div>
                    )}
                    {selectedBin.waste_category && (
                      <div>
                        <div className="text-gray-600 text-xs">Waste Category</div>
                        <div className="text-gray-900">{selectedBin.waste_category}</div>
                      </div>
                    )}
                    <div>
                      <div className="text-gray-600 text-xs">Coordinates</div>
                      <div className="font-mono text-gray-900">
                        {Number(selectedBin.latitude).toFixed(6)}, {Number(selectedBin.longitude).toFixed(6)}
                      </div>
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300] p-4" onClick={() => setShowMoveLocationModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Navigation className="size-6 text-orange-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Move Bin Location</h3>
                  <p className="text-sm text-gray-600">Relocate {binToMove.code ?? binToMove.id}</p>
                </div>
              </div>
              <button onClick={() => setShowMoveLocationModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="size-6" />
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
              <div className="space-y-4">
                <input value={moveForm.location} onChange={(event) => setMoveForm((prev) => ({ ...prev, location: event.target.value }))} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg" placeholder="New location address" />
                <div className="grid grid-cols-2 gap-3">
                  <CustomSelect
                    value={moveForm.barangay}
                    onChange={(barangay) => setMoveForm((prev) => ({ ...prev, barangay }))}
                    options={[
                      { value: "", label: "Barangay" },
                      ...barangayOptions.map((brgy) => ({ value: brgy, label: brgy })),
                    ]}
                    ariaLabel="Barangay"
                  />
                  <CustomSelect
                    value={moveForm.area_code}
                    onChange={(area_code) => setMoveForm((prev) => ({ ...prev, area_code }))}
                    options={[{ value: "", label: "SWMO Area" }, ...areaOptions]}
                    ariaLabel="SWMO Area"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <input type="number" step="any" value={moveForm.lat} onChange={(event) => setMoveForm((prev) => ({ ...prev, lat: event.target.value }))} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg" placeholder="Latitude" />
                  <input type="number" step="any" value={moveForm.lng} onChange={(event) => setMoveForm((prev) => ({ ...prev, lng: event.target.value }))} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg" placeholder="Longitude" />
                </div>
                <p className="text-xs text-gray-500">The pin starts at the current saved bin location. Drag it or click a new point to relocate the bin and mark its coordinates as verified.</p>
                {formError && <p className="text-sm text-red-600">{formError}</p>}
              </div>
              <BinLocationPicker
                latitude={coordinateValue(moveForm.lat)}
                longitude={coordinateValue(moveForm.lng)}
                onChange={({ latitude, longitude }) =>
                  setMoveForm((prev) => ({ ...prev, lat: formatCoordinate(latitude), lng: formatCoordinate(longitude) }))
                }
                className="h-[380px] w-full"
              />
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
        isOpen={Boolean(binToToggle)}
        onClose={() => setBinToToggle(null)}
        onConfirm={async () => {
          if (!binToToggle) return;
          if (isBinActive(binToToggle)) {
            await disableBin(binToToggle.id);
          } else {
            await enableBin(binToToggle.id);
          }
        }}
        title={binToToggle && !isBinActive(binToToggle) ? "Re-enable Bin" : "Disable Bin"}
        message={
          binToToggle && !isBinActive(binToToggle)
            ? `Re-enable ${binToToggle.code ?? "this collection site"}? It will become active again for route planning and waste collection workflows.`
            : `Disable ${binToToggle?.code ?? "this collection site"}? Its database record, route history, and collection history will be preserved, and it will be excluded from active collection points and newly generated routes.`
        }
        variant={binToToggle && !isBinActive(binToToggle) ? "info" : "warning"}
        confirmText={binToToggle && !isBinActive(binToToggle) ? "Re-enable Bin" : "Disable Bin"}
      />
    </>
  );
}
