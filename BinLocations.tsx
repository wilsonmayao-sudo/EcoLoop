import React, { useEffect, useMemo, useState } from "react";

import {

  MapPin,

  Plus,

  X,

  Pencil,

  Power,

  PowerOff,

  AlertTriangle,

  Clock3,

  CheckCircle2,

  Search,

  SlidersHorizontal,

  RotateCcw,

  History,

  FileWarning,

  Send,

  Camera,

  LocateFixed,

  ImagePlus,

  Trash2,

  Truck,

  Route,

  UserRound,

  Radio,

  Gauge,

  Activity,

} from "lucide-react";

import NotificationDropdown from "../components/feedback/NotificationDropdown";

import RoleIndicator from "../components/layout/RoleIndicator";

import ConfirmModal from "../components/feedback/ConfirmModal";

import {

  formatDateOnly,

  useLiveData,

  type BinRecord,

} from "../hooks/useLiveData";

import BinLocationPicker from "../components/maps/BinLocationPicker";

import CustomSelect from "../components/ui/CustomSelect";

type PageType =

  | "dashboard"

  | "route-planning"

  | "vehicle-monitoring"

  | "reports"

  | "bin-locations"

  | "notifications";

interface BinLocationsProps {

  onNavigate?: (page: PageType) => void;

}

/**

*  Extended frontend type.*

*  These fields are optional so older bin records can still display*

*  even if they were created before these fields were introduced.*

*/

type ExtendedBinRecord = BinRecord & {

  barangay?: string | null;

  collection_status?: string | null;

  last_collected_at?: string | null;

  updated_at?: string | null;

};

const NAGA_CITY_COORDINATE = {

  latitude: 13.6218,

  longitude: 123.1948,

};

const emptyBinForm = {

  code: "",

  location: "",

  barangay: "",

  type: "",

  operationalStatus: "active",

  lat: String(NAGA_CITY_COORDINATE.latitude),

  lng: String(NAGA_CITY_COORDINATE.longitude),

};

const OPERATIONAL_STATUS_OPTIONS = [

  {

    value: "active",

    label: "Active",

  },

  {

    value: "inactive",

    label: "Inactive",

  },

];

const COLLECTION_STATUS_OPTIONS = [

  {

    value: "pending",

    label: "Pending",

  },

  {

    value: "en_route",

    label: "En Route",

  },

  {

    value: "collected",

    label: "Collected",

  },

  {

    value: "delayed",

    label: "Delayed",

  },

  {

    value: "missed",

    label: "Missed",

  },


];

const ISSUE_TYPE_OPTIONS = [
  { value: "overflow", label: "Overflow" },
  { value: "damaged_bin", label: "Damaged Bin" },
  { value: "missing_bin", label: "Missing Bin" },
  { value: "blocked_inaccessible", label: "Blocked / Inaccessible" },
  { value: "missed_collection", label: "Missed Collection" },
  { value: "incorrect_location", label: "Incorrect Location" },
  { value: "other", label: "Other" },
];

const ISSUE_PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const NEARBY_COLLECTION_POINT_WARNING_METERS = 30;

// Official Naga City barangays (27). Keep this list separate from service/coverage zones.
const NAGA_CITY_BARANGAYS = [
  "Abella",
  "Bagumbayan Norte",
  "Bagumbayan Sur",
  "Balatas",
  "Calauag",
  "Cararayan",
  "Carolina",
  "Concepcion Grande",
  "Concepcion Pequeña",
  "Dayangdang",
  "Del Rosario",
  "Dinaga",
  "Igualdad Interior",
  "Lerma",
  "Liboton",
  "Mabolo",
  "Pacol",
  "Panicuason",
  "Peñafrancia",
  "Sabang",
  "San Felipe",
  "San Francisco",
  "San Isidro",
  "Santa Cruz",
  "Tabuco",
  "Tinago",
  "Triangulo",
] as const;

type NearbyCollectionPointWarning = {
  id: string | number;
  code: string;
  location: string;
  distanceMeters: number;
};

export default function BinLocations({

  onNavigate,

}: BinLocationsProps) {

  const {

    bins,

    binTypes,

    deliveries,

    routeStops,

    vehicles,

    vehicleLocations,

    reports,

    driverById,

    routeById,

    vehicleById,

    currentRole,

    binLocationPermissions,

    loading,

    error,

    createBin,

    updateBin,

    createReport,

    uploadReportImage,

  } = useLiveData();

  const permissionsConfigured = Boolean(binLocationPermissions);
  const canReadCollectionPoints = binLocationPermissions?.can_read ?? true;
  const canCreateCollectionPoints = binLocationPermissions?.can_create ?? false;
  const canUpdateCollectionPoints = binLocationPermissions?.can_update ?? false;

  // Permanent collection-point maintenance requires both create and update permission.
  const canMaintainCollectionPoints =
    canCreateCollectionPoints && canUpdateCollectionPoints;
  const canReportIssues = canReadCollectionPoints;

  const [showAddModal, setShowAddModal] = useState(false);

  const [selectedBin, setSelectedBin] =

    useState<ExtendedBinRecord | null>(null);

  const [showMapModal, setShowMapModal] = useState(false);

  const [showMoveLocationModal, setShowMoveLocationModal] =

    useState(false);

  const [binToMove, setBinToMove] =

    useState<ExtendedBinRecord | null>(null);

  const [binToToggle, setBinToToggle] =

    useState<ExtendedBinRecord | null>(null);

  const [formError, setFormError] =

    useState<string | null>(null);

  const [newBin, setNewBin] = useState(emptyBinForm);

  const [nearbyCollectionPointWarning, setNearbyCollectionPointWarning] =
    useState<NearbyCollectionPointWarning | null>(null);

  const [moveForm, setMoveForm] = useState({

    location: "",

    barangay: "",

    type: "",

    lat: "",

    lng: "",

  });

  const [searchQuery, setSearchQuery] = useState("");

  const [barangayFilter, setBarangayFilter] = useState("all");

  const [typeFilter, setTypeFilter] = useState("all");

  const [operationalStatusFilter, setOperationalStatusFilter] = useState("all");

  const [collectionStatusFilter, setCollectionStatusFilter] = useState("all");

  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const [showReportModal, setShowReportModal] = useState(false);

  const [reportBin, setReportBin] = useState<ExtendedBinRecord | null>(null);

  const [reportSubmitting, setReportSubmitting] = useState(false);

  const [reportSuccess, setReportSuccess] = useState<string | null>(null);

  const [reportPhoto, setReportPhoto] = useState<File | null>(null);

  const [reportPhotoPreview, setReportPhotoPreview] = useState<string | null>(null);

  const [reportTimestamp, setReportTimestamp] = useState<string>("");

  const [reportGpsLoading, setReportGpsLoading] = useState(false);

  const [reportGpsMessage, setReportGpsMessage] = useState<string>("");

  const [reportGps, setReportGps] = useState<{
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    source: "device" | "collection_point";
  }>({
    latitude: null,
    longitude: null,
    accuracy: null,
    source: "collection_point",
  });

  const [reportForm, setReportForm] = useState({
    type: "overflow",
    priority: "medium",
    description: "",
  });

  useEffect(() => {
    return () => {
      if (reportPhotoPreview) {
        URL.revokeObjectURL(reportPhotoPreview);
      }
    };
  }, [reportPhotoPreview]);

  /**

*    SUMMARY COUNTERS*

*  */

  const activeBins = useMemo(

    () =>

      bins.filter(

        (bin) =>

          (bin.status ?? "active").toLowerCase() === "active",

      ).length,

    [bins],

  );

  const mappedBins = useMemo(

    () =>

      bins.filter((bin) => {

        const latitude = Number(bin.latitude);

        const longitude = Number(bin.longitude);

        return (

          Number.isFinite(latitude) &&

          Number.isFinite(longitude) &&

          latitude >= -90 &&

          latitude <= 90 &&

          longitude >= -180 &&

          longitude <= 180

        );

      }).length,

    [bins],

  );

  const attentionByBin = useMemo(() => {
    const attention = new Map<
      string,
      {
        collectionStatus: string;
        inactive: boolean;
        openIssues: number;
        invalidBarangay: boolean;
      }
    >();

    const unresolvedIssueCounts = new Map<string, number>();

    reports.forEach((report) => {
      if (report.bin_id == null) return;

      const status = (report.status ?? "pending")
        .toLowerCase()
        .replace(/\s+/g, "_");

      const isResolved = [
        "resolved",
        "closed",
        "completed",
        "dismissed",
        "cancelled",
        "canceled",
      ].includes(status);

      if (isResolved) return;

      const key = String(report.bin_id);
      unresolvedIssueCounts.set(key, (unresolvedIssueCounts.get(key) ?? 0) + 1);
    });

    bins.forEach((record) => {
      const bin = record as ExtendedBinRecord;
      const key = String(bin.id);
      const collectionStatus = (bin.collection_status ?? "pending")
        .toLowerCase()
        .replace(/\s+/g, "_");
      const inactive = (bin.status ?? "active").toLowerCase() !== "active";
      const openIssues = unresolvedIssueCounts.get(key) ?? 0;
      const barangay = (bin.barangay ?? "").trim();
      const invalidBarangay =
        !barangay ||
        !NAGA_CITY_BARANGAYS.some(
          (officialBarangay) =>
            officialBarangay.toLowerCase() === barangay.toLowerCase(),
        );

      if (
        inactive ||
        ["delayed", "missed"].includes(collectionStatus) ||
        openIssues > 0 ||
        invalidBarangay
      ) {
        attention.set(key, {
          collectionStatus,
          inactive,
          openIssues,
          invalidBarangay,
        });
      }
    });

    return attention;
  }, [bins, reports]);

  const needsAttention = attentionByBin.size;

  const activeBinTypes = useMemo(

    () =>
      binTypes
        .map((type) => type.name?.trim())
        .filter((name): name is string => Boolean(name)),

    [binTypes],

  );

  const activeBarangays = useMemo<string[]>(
    () => [...NAGA_CITY_BARANGAYS],
    [],
  );

  const barangayOptions = useMemo(

    () =>
      activeBarangays.map((barangay) => ({
        value: barangay,
        label: barangay,
      })),

    [activeBarangays],

  );

  const availableBarangays = useMemo(
    () => [...activeBarangays],
    [activeBarangays],
  );

  const availableTypes = useMemo(() => {

    const values = new Set<string>(activeBinTypes);

    bins.forEach((bin) => {
      if (bin.type?.trim()) values.add(bin.type.trim());
    });

    return Array.from(values).sort((a, b) => a.localeCompare(b));

  }, [activeBinTypes, bins]);

  const filteredBins = useMemo(() => {

    const query = searchQuery.trim().toLowerCase();

    return bins.filter((record) => {

      const bin = record as ExtendedBinRecord;

      const code = String(bin.code ?? bin.id ?? "").toLowerCase();

      const location = (bin.location ?? "").toLowerCase();

      const barangay = (bin.barangay ?? "").toLowerCase();

      const type = (bin.type ?? "").toLowerCase();

      const operationalStatus = (bin.status ?? "active").toLowerCase();

      const collectionStatus = (bin.collection_status ?? "pending")

        .toLowerCase()

        .replace(/\s+/g, "_");

      const matchesSearch =

        !query ||

        code.includes(query) ||

        location.includes(query) ||

        barangay.includes(query);

      const matchesBarangay =

        barangayFilter === "all" ||

        barangay === barangayFilter.toLowerCase();

      const matchesType =

        typeFilter === "all" ||

        type === typeFilter.toLowerCase();

      const matchesOperationalStatus =

        operationalStatusFilter === "all" ||

        operationalStatus === operationalStatusFilter;

      const matchesCollectionStatus =

        collectionStatusFilter === "all" ||

        collectionStatus === collectionStatusFilter;

      return (

        matchesSearch &&

        matchesBarangay &&

        matchesType &&

        matchesOperationalStatus &&

        matchesCollectionStatus

      );

    });

  }, [

    bins,

    searchQuery,

    barangayFilter,

    typeFilter,

    operationalStatusFilter,

    collectionStatusFilter,

  ]);

  const hasActiveFilters =

    Boolean(searchQuery.trim()) ||

    barangayFilter !== "all" ||

    typeFilter !== "all" ||

    operationalStatusFilter !== "all" ||

    collectionStatusFilter !== "all";

  const clearFilters = () => {

    setSearchQuery("");

    setBarangayFilter("all");

    setTypeFilter("all");

    setOperationalStatusFilter("all");

    setCollectionStatusFilter("all");

  };

  const selectedBinHistory = useMemo(() => {
    if (!selectedBin) return [];

    return deliveries
      .filter((delivery) => String(delivery.bin_id ?? "") === String(selectedBin.id))
      .slice()
      .sort((a, b) => {
        const aTime = new Date(a.completed_at ?? a.updated_at ?? 0).getTime();
        const bTime = new Date(b.completed_at ?? b.updated_at ?? 0).getTime();
        return bTime - aTime;
      });
  }, [deliveries, selectedBin]);

  const selectedBinReports = useMemo(() => {
    if (!selectedBin) return [];

    return reports
      .filter((report) => String(report.bin_id ?? "") === String(selectedBin.id))
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [reports, selectedBin]);

  /** Current operational assignment for the selected collection point. */
  const selectedBinCurrentDelivery = useMemo(() => {
    if (!selectedBin) return null;

    const rows = deliveries
      .filter((delivery) => String(delivery.bin_id ?? "") === String(selectedBin.id))
      .filter((delivery) => {
        const status = (delivery.status ?? "").toLowerCase().replace(/\s+/g, "_");
        const isFinished =
          Boolean(delivery.completed_at) ||
          ["completed", "collected", "success", "successful", "missed", "failed", "failure", "cancelled", "canceled"].includes(status);
        return !isFinished;
      })
      .slice()
      .sort((a, b) => {
        const aTime = new Date(a.updated_at ?? a.started_at ?? a.created_at ?? 0).getTime();
        const bTime = new Date(b.updated_at ?? b.started_at ?? b.created_at ?? 0).getTime();
        return bTime - aTime;
      });

    return rows[0] ?? null;
  }, [deliveries, selectedBin]);

  const selectedBinCurrentRoute = useMemo(() => {
    if (!selectedBinCurrentDelivery) return null;
    return routeById.get(String(selectedBinCurrentDelivery.route_id)) ?? null;
  }, [routeById, selectedBinCurrentDelivery]);

  const selectedBinCurrentDriver = useMemo(() => {
    const driverId =
      selectedBinCurrentDelivery?.driver_id ?? selectedBinCurrentRoute?.driver_id ?? null;
    if (driverId == null) return null;
    return driverById.get(String(driverId)) ?? null;
  }, [driverById, selectedBinCurrentDelivery, selectedBinCurrentRoute]);

  const selectedBinCurrentVehicle = useMemo(() => {
    const assignedVehicleId = selectedBinCurrentDriver?.assigned_vehicle_id;
    if (assignedVehicleId != null) {
      const assignedVehicle = vehicleById.get(String(assignedVehicleId));
      if (assignedVehicle) return assignedVehicle;
    }

    const routeId = selectedBinCurrentDelivery?.route_id;
    const driverId =
      selectedBinCurrentDelivery?.driver_id ?? selectedBinCurrentRoute?.driver_id ?? null;

    if (routeId != null) {
      const routeVehicle = vehicles.find(
        (vehicle) => String(vehicle.route_id ?? "") === String(routeId),
      );
      if (routeVehicle) return routeVehicle;
    }

    if (driverId != null) {
      return (
        vehicles.find((vehicle) => String(vehicle.driver_id ?? "") === String(driverId)) ?? null
      );
    }

    return null;
  }, [
    selectedBinCurrentDelivery,
    selectedBinCurrentDriver,
    selectedBinCurrentRoute,
    vehicleById,
    vehicles,
  ]);

  const selectedBinRouteProgress = useMemo(() => {
    const routeId = selectedBinCurrentDelivery?.route_id;
    if (routeId == null) return null;

    const routeDeliveries = deliveries.filter(
      (delivery) => String(delivery.route_id) === String(routeId),
    );
    if (routeDeliveries.length === 0) return null;

    const completed = routeDeliveries.filter((delivery) => {
      const status = (delivery.status ?? "").toLowerCase().replace(/\s+/g, "_");
      return (
        Boolean(delivery.completed_at) ||
        ["completed", "collected", "success", "successful"].includes(status)
      );
    }).length;

    return {
      completed,
      total: routeDeliveries.length,
      percent: Math.round((completed / routeDeliveries.length) * 100),
    };
  }, [deliveries, selectedBinCurrentDelivery]);

  const selectedBinStopPosition = useMemo(() => {
    if (!selectedBin || !selectedBinCurrentDelivery) return null;

    const routeId = String(selectedBinCurrentDelivery.route_id);
    const stops = routeStops
      .filter((stop) => String(stop.route_id) === routeId)
      .slice()
      .sort((a, b) => Number(a.stop_order) - Number(b.stop_order));

    const stop = stops.find((item) => String(item.bin_id) === String(selectedBin.id));
    if (!stop) return null;

    const index = stops.findIndex((item) => String(item.bin_id) === String(selectedBin.id));
    return {
      stopOrder: Number(stop.stop_order),
      position: index >= 0 ? index + 1 : Number(stop.stop_order),
      total: stops.length,
    };
  }, [routeStops, selectedBin, selectedBinCurrentDelivery]);

  const selectedVehicleLiveLocation = useMemo(() => {
    if (!selectedBinCurrentVehicle) return null;

    return (
      vehicleLocations
        .filter(
          (location) =>
            String(location.vehicle_id ?? "") === String(selectedBinCurrentVehicle.id),
        )
        .slice()
        .sort((a, b) => {
          const aTime = new Date(a.updated_at ?? a.recorded_at ?? 0).getTime();
          const bTime = new Date(b.updated_at ?? b.recorded_at ?? 0).getTime();
          return bTime - aTime;
        })[0] ?? null
    );
  }, [selectedBinCurrentVehicle, vehicleLocations]);


  /**

*    COORDINATE HELPERS*

*  */

  const parseCoordinates = (

    latValue: string,

    lngValue: string,

  ) => {

    if (!latValue.trim() || !lngValue.trim()) {

      throw new Error(

        "Select a location on the map or enter latitude and longitude.",

      );

    }

    const latitude = Number(latValue);

    const longitude = Number(lngValue);

    if (

      !Number.isFinite(latitude) ||

      !Number.isFinite(longitude)

    ) {

      throw new Error(

        "Latitude and longitude must be valid numbers.",

      );

    }

    if (

      latitude < -90 ||

      latitude > 90 ||

      longitude < -180 ||

      longitude > 180

    ) {

      throw new Error(

        "Latitude must be between -90 and 90, and longitude between -180 and 180.",

      );

    }

    return {

      latitude,

      longitude,

    };

  };

  const formatCoordinate = (value: number) =>

    value.toFixed(6);

  const coordinateValue = (value: string) => {

    if (!value.trim()) {

      return null;

    }

    const parsed = Number(value);

    return Number.isFinite(parsed)

      ? parsed

      : null;

  };

  /**

*    DISPLAY HELPERS*

*  */

  const distanceBetweenCoordinatesMeters = (
    latitudeA: number,
    longitudeA: number,
    latitudeB: number,
    longitudeB: number,
  ) => {
    const toRadians = (value: number) => (value * Math.PI) / 180;
    const earthRadiusMeters = 6371000;
    const latitudeDelta = toRadians(latitudeB - latitudeA);
    const longitudeDelta = toRadians(longitudeB - longitudeA);
    const startLatitude = toRadians(latitudeA);
    const endLatitude = toRadians(latitudeB);

    const haversine =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(startLatitude) *
        Math.cos(endLatitude) *
        Math.sin(longitudeDelta / 2) ** 2;

    return (
      2 *
      earthRadiusMeters *
      Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    );
  };

  const findNearbyCollectionPoint = (latitude: number, longitude: number) => {
    let nearest: NearbyCollectionPointWarning | null = null;

    bins.forEach((record) => {
      const bin = record as ExtendedBinRecord;
      const binLatitude = Number(bin.latitude);
      const binLongitude = Number(bin.longitude);

      if (!Number.isFinite(binLatitude) || !Number.isFinite(binLongitude)) return;

      const distanceMeters = distanceBetweenCoordinatesMeters(
        latitude,
        longitude,
        binLatitude,
        binLongitude,
      );

      if (
        distanceMeters <= NEARBY_COLLECTION_POINT_WARNING_METERS &&
        (!nearest || distanceMeters < nearest.distanceMeters)
      ) {
        nearest = {
          id: bin.id,
          code: String(bin.code ?? bin.id),
          location: bin.location,
          distanceMeters,
        };
      }
    });

    return nearest;
  };

  const getTypeColor = (type?: string | null) => {

    switch ((type ?? "").toLowerCase()) {

      case "residential":

        return "bg-blue-100 text-blue-700";

      case "commercial":

        return "bg-purple-100 text-purple-700";

      case "industrial":

        return "bg-amber-100 text-amber-700";

      case "institutional":

        return "bg-indigo-100 text-indigo-700";

      case "market":

        return "bg-orange-100 text-orange-700";

      case "mrf":

        return "bg-teal-100 text-teal-700";

      case "public_area":

      case "public area":

        return "bg-cyan-100 text-cyan-700";

      default:

        return "bg-gray-100 text-gray-700";

    }

  };

  const getOperationalStatusColor = (

    status?: string | null,

  ) => {

    if (

      (status ?? "active").toLowerCase() === "active"

    ) {

      return "bg-emerald-50 text-emerald-700";

    }

    return "bg-gray-100 text-gray-600";

  };

  const getCollectionStatusColor = (

    status?: string | null,

  ) => {

    switch ((status ?? "pending").toLowerCase()) {

      case "collected":

        return "bg-emerald-100 text-emerald-700";

      case "en_route":

      case "en route":

        return "bg-blue-100 text-blue-700";

      case "delayed":

        return "bg-amber-100 text-amber-700";

      case "missed":

        return "bg-red-100 text-red-700";


      case "pending":

      default:

        return "bg-gray-100 text-gray-700";

    }

  };

  const formatCollectionStatus = (

    status?: string | null,

  ) => {

    if (!status) {

      return "Pending";

    }

    return status

      .replaceAll("_", " ")

      .replace(/\b\w/g, (character) =>

        character.toUpperCase(),

      );

  };

  const formatDateTime = (

    value?: string | null,

  ) => {

    if (!value) {

      return "Not available";

    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {

      return "Not available";

    }

    return parsed.toLocaleString("en-PH", {

      year: "numeric",

      month: "short",

      day: "numeric",

      hour: "numeric",

      minute: "2-digit",

    });

  };

  /**

*    ADD BIN*

*  */

  const handleAddBin = async (allowNearbyDuplicate = false) => {

    if (!canCreateCollectionPoints) {
      setFormError("Your role does not have permission to add collection points.");
      return;
    }

    try {

      setFormError(null);

      if (

        !newBin.code.trim() ||

        !newBin.location.trim() ||

        !newBin.barangay.trim() ||

        !newBin.type.trim()

      ) {

        setFormError(

          "Code, location, barangay, and type are required.",

        );

        return;

      }

      const normalizedCode =

        newBin.code.trim().toLowerCase();

      const duplicateCode = bins.some(

        (bin) =>

          (bin.code ?? "")

            .trim()

            .toLowerCase() === normalizedCode,

      );

      if (duplicateCode) {

        setFormError(

          "Collection Point ID already exists.",

        );

        return;

      }

      const coordinates = parseCoordinates(

        newBin.lat,

        newBin.lng,

      );

      if (!activeBarangays.includes(newBin.barangay.trim())) {
        setFormError(
          "Select a valid Naga City barangay.",
        );
        return;
      }

      if (!activeBinTypes.includes(newBin.type.trim())) {
        setFormError(
          "Select an active collection point type from the configured bin types.",
        );
        return;
      }

      const nearbyPoint = findNearbyCollectionPoint(
        coordinates.latitude,
        coordinates.longitude,
      );

      if (nearbyPoint) {
        const warningMatchesCurrentCoordinates =
          nearbyCollectionPointWarning != null &&
          String(nearbyCollectionPointWarning.id) === String(nearbyPoint.id) &&
          Math.abs(
            nearbyCollectionPointWarning.distanceMeters - nearbyPoint.distanceMeters,
          ) < 0.5;

        if (!allowNearbyDuplicate || !warningMatchesCurrentCoordinates) {
          setNearbyCollectionPointWarning(nearbyPoint);
          setFormError(null);
          return;
        }
      }

      setNearbyCollectionPointWarning(null);

      /**

*        "as any" is used temporarily because BinRecord/createBin*

*        may not yet contain the new database columns.*

*        Once useLiveData.ts is updated, this cast can be removed.*

*      */

      await createBin({

        code: newBin.code.trim(),

        location: newBin.location.trim(),

        barangay: newBin.barangay.trim(),

        type:

          newBin.type.trim(),

        latitude:

          coordinates.latitude,

        longitude:

          coordinates.longitude,

        status:

          newBin.operationalStatus,

        is_active:

          newBin.operationalStatus === "active",

      } as any);

      setNewBin(emptyBinForm);
      setNearbyCollectionPointWarning(null);

      setShowAddModal(false);

    } catch (err: any) {

      setFormError(

        err?.message ??

          "Unable to add collection point.",

      );

    }

  };

  const clearReportPhoto = () => {
    setReportPhoto(null);
    setReportPhotoPreview(null);
  };

  const captureReportGps = async (bin: ExtendedBinRecord) => {
    const fallbackLatitude = Number(bin.latitude);
    const fallbackLongitude = Number(bin.longitude);
    const hasFallback = Number.isFinite(fallbackLatitude) && Number.isFinite(fallbackLongitude);

    if (hasFallback) {
      setReportGps({
        latitude: fallbackLatitude,
        longitude: fallbackLongitude,
        accuracy: null,
        source: "collection_point",
      });
    } else {
      setReportGps({ latitude: null, longitude: null, accuracy: null, source: "collection_point" });
    }

    if (!navigator.geolocation) {
      setReportGpsMessage(
        hasFallback
          ? "Device GPS is unavailable. Using the saved collection-point coordinates."
          : "GPS is unavailable and this collection point has no saved coordinates.",
      );
      return;
    }

    setReportGpsLoading(true);
    setReportGpsMessage("Requesting your current GPS location...");

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 30000,
        });
      });

      setReportGps({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        source: "device",
      });
      setReportGpsMessage(
        Number.isFinite(position.coords.accuracy)
          ? `Current device GPS captured (±${Math.round(position.coords.accuracy)} m).`
          : "Current device GPS captured.",
      );
    } catch (gpsError: any) {
      setReportGpsMessage(
        hasFallback
          ? "Current GPS permission was unavailable, so the saved collection-point coordinates will be used."
          : gpsError?.message || "Unable to capture GPS coordinates.",
      );
    } finally {
      setReportGpsLoading(false);
    }
  };

  const handleReportPhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      clearReportPhoto();
      return;
    }

    if (!file.type.startsWith("image/")) {
      setFormError("Please select an image file for the report photo.");
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setFormError("The report photo must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }

    setFormError(null);
    setReportPhoto(file);
    setReportPhotoPreview(URL.createObjectURL(file));
  };

  const openReportIssue = (bin: ExtendedBinRecord) => {
    if (!canReportIssues) {
      setFormError("Your role does not have permission to report issues from this page.");
      return;
    }

    clearReportPhoto();
    const now = new Date().toISOString();
    setReportBin(bin);
    setReportTimestamp(now);
    setReportForm({ type: "overflow", priority: "medium", description: "" });
    setReportSuccess(null);
    setFormError(null);
    setReportGpsMessage("");
    setShowReportModal(true);
    void captureReportGps(bin);
  };

  const handleSubmitIssue = async () => {
    if (!canReportIssues) {
      setFormError("Your role does not have permission to submit issue reports.");
      return;
    }

    if (!reportBin) return;

    if (!reportForm.description.trim()) {
      setFormError("Please add notes describing the issue before submitting.");
      return;
    }

    if (reportGps.latitude == null || reportGps.longitude == null) {
      setFormError("A GPS location is required. Try Refresh GPS or update the collection-point location first.");
      return;
    }

    try {
      setReportSubmitting(true);
      setFormError(null);

      const now = new Date().toISOString();
      const createdAt = reportTimestamp || now;
      const reportNumber = `BIN-${Date.now()}`;
      const imageUrl = reportPhoto
        ? await uploadReportImage(reportPhoto, reportNumber)
        : null;

      await createReport({
        report_id: reportNumber,
        report_number: reportNumber,
        report_type: reportForm.type,
        type: reportForm.type,
        location: reportBin.location,
        image_url: imageUrl,
        latitude: reportGps.latitude,
        longitude: reportGps.longitude,
        status: "pending",
        priority: reportForm.priority,
        description: reportForm.description.trim(),
        bin_id: reportBin.id,
        created_at: createdAt,
        updated_at: now,
      });

      setReportSuccess("Issue report submitted successfully.");
      setReportForm({ type: "overflow", priority: "medium", description: "" });
      clearReportPhoto();
      setReportTimestamp(new Date().toISOString());
    } catch (err: any) {
      setFormError(err?.message ?? "Unable to submit issue report.");
    } finally {
      setReportSubmitting(false);
    }
  };

  /**

*    EDIT LOCATION*

*  */

  const handleMoveBin = async () => {

    if (!canMaintainCollectionPoints) {
      setFormError("Your role does not have permission to edit collection-point locations.");
      return;
    }

    if (!binToMove) {

      return;

    }

    try {

      setFormError(null);

      if (
        !moveForm.location.trim() ||
        !moveForm.barangay.trim() ||
        !moveForm.type.trim()
      ) {
        setFormError(
          "Location, barangay, and collection point type are required.",
        );
        return;
      }

      const coordinates = parseCoordinates(

        moveForm.lat,

        moveForm.lng,

      );

      if (!activeBarangays.includes(moveForm.barangay.trim())) {
        setFormError("Select a valid Naga City barangay.");
        return;
      }

      await updateBin(binToMove.id, {

        location: moveForm.location.trim(),

        barangay: moveForm.barangay.trim(),

        type: moveForm.type.trim(),

        latitude:

          coordinates.latitude,

        longitude:

          coordinates.longitude,

      });

      setShowMoveLocationModal(false);

      setBinToMove(null);

    } catch (err: any) {

      setFormError(

        err?.message ??

          "Unable to update collection point.",

      );

    }

  };

  const handleViewMap = (

    bin: BinRecord,

  ) => {

    setSelectedBin(

      bin as ExtendedBinRecord,

    );

    setShowMapModal(true);

  };

  const handleToggleBinStatus = async () => {

    if (!canMaintainCollectionPoints) {
      window.alert("Your role does not have permission to enable or disable collection points.");
      return;
    }

    if (!binToToggle) {

      return;

    }

    const currentlyActive =

      (binToToggle.status ?? "active").toLowerCase() === "active";

    const nextStatus = currentlyActive ? "inactive" : "active";

    try {

      await updateBin(

        binToToggle.id,

        {

          status: nextStatus,

          is_active: nextStatus === "active",

        } as any,

      );

      setBinToToggle(null);

    } catch (err: any) {

      window.alert(

        err?.message ??

          `Unable to ${currentlyActive ? "disable" : "enable"} this collection point.`,

      );

    }

  };

  if (!canReadCollectionPoints) {
    return (
      <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">
        <div className="space-y-6">
          <RoleIndicator />
          <div className="rounded-xl border border-red-200 bg-white p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-red-700">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">
              Your role does not have permission to view the Collection Points module.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (

    <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">

      <div className="space-y-6">

        <RoleIndicator />

        {/* PAGE HEADER */}

        <div className="flex items-center justify-between">

          <div>

            <h2 className="text-gray-900">

              Collection Points

            </h2>

            <p className="text-gray-600">

              Naga City Collection Point Management

            </p>

          </div>

          <div className="flex items-center gap-4">

            <div className="text-right">

              <div className="text-sm text-gray-900">

                Today

              </div>

              <div className="text-xs text-gray-500">

                {formatDateOnly(

                  new Date().toISOString(),

                )}

              </div>

            </div>

            {onNavigate && (

              <NotificationDropdown

                onViewAll={() =>

                  onNavigate(

                    "notifications",

                  )

                }

              />

            )}

          </div>

        </div>

        {/* ERROR */}

        {error && (

          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">

            {error}

          </div>

        )}

        {!permissionsConfigured && currentRole && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No Collection Points permission is configured for role{" "}
            <span className="font-medium">{String(currentRole)}</span>. This page is read-only until the role permission is configured.
          </div>
        )}

        {/* SUMMARY CARDS */}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">

          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">

            <div className="text-gray-600 text-sm">

              Total Collection Points

            </div>

            <div className="text-gray-900 mt-2 text-xl">

              {loading

                ? "..."

                : bins.length}

            </div>

            <div className="text-blue-500 text-sm mt-1">

              Registered locations

            </div>

          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">

            <div className="text-gray-600 text-sm">

              Active Collection Points

            </div>

            <div className="text-gray-900 mt-2 text-xl">

              {loading

                ? "..."

                : activeBins}

            </div>

            <div className="text-emerald-500 text-sm mt-1">

              Available for collection

            </div>

          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">

            <div className="text-gray-600 text-sm">

              Mapped Locations

            </div>

            <div className="text-gray-900 mt-2 text-xl">

              {loading

                ? "..."

                : `${mappedBins}/${bins.length}`}

            </div>

            <div className="text-blue-500 text-sm mt-1">

              GPS coordinates recorded

            </div>

          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">

            <div className="flex items-center gap-2">

              <div className="text-gray-600 text-sm">

                Needs Attention

              </div>

              <AlertTriangle className="size-4 text-amber-500" />

            </div>

            <div className="text-gray-900 mt-2 text-xl">

              {loading

                ? "..."

                : needsAttention}

            </div>

            <div className="text-amber-600 text-sm mt-1">

              Delayed, missed, inactive, open issues, or barangay correction needed

            </div>

          </div>

        </div>

        {/* LIST HEADER */}

        <div className="flex items-center justify-between">

          <div>

            <h3 className="text-gray-900">

              All Collection Points

            </h3>

            <p className="text-sm text-gray-600">

              Manage Naga City collection points, operational status, and collection activity.

            </p>

          </div>

          {canCreateCollectionPoints && (
            <button
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all shadow-md hover:shadow-lg"
              onClick={() => {
                setNewBin(emptyBinForm);
                setNearbyCollectionPointWarning(null);
                setFormError(null);
                setShowAddModal(true);
              }}
            >
              <Plus className="size-5" />
              <span>Add Collection Point</span>
            </button>
          )}

        </div>

        {/* SEARCH AND FILTERS */}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">

          <div className="flex items-center gap-2 mb-4">

            <SlidersHorizontal className="size-4 text-gray-500" />

            <div className="text-sm font-medium text-gray-800">Search & Filters</div>

          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">

            <div className="relative md:col-span-2 xl:col-span-1">

              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />

              <input

                value={searchQuery}

                onChange={(event) => setSearchQuery(event.target.value)}

                placeholder="Search ID, location, barangay..."

                className="w-full h-10 pl-9 pr-3 border border-gray-300 rounded-lg bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"

              />

            </div>

            <select

              value={barangayFilter}

              onChange={(event) => setBarangayFilter(event.target.value)}

              className="h-10 px-3 border border-gray-300 rounded-lg bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"

              aria-label="Filter by barangay"

            >

              <option value="all">All Barangays</option>

              {availableBarangays.map((barangay) => (

                <option key={barangay} value={barangay}>

                  {barangay}

                </option>

              ))}

            </select>

            <select

              value={typeFilter}

              onChange={(event) => setTypeFilter(event.target.value)}

              className="h-10 px-3 border border-gray-300 rounded-lg bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent capitalize"

              aria-label="Filter by collection point type"

            >

              <option value="all">All Types</option>

              {availableTypes.map((type) => (

                <option key={type} value={type}>

                  {type}

                </option>

              ))}

            </select>

            <select

              value={operationalStatusFilter}

              onChange={(event) => setOperationalStatusFilter(event.target.value)}

              className="h-10 px-3 border border-gray-300 rounded-lg bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"

              aria-label="Filter by operational status"

            >

              <option value="all">All Operational Status</option>

              <option value="active">Active</option>

              <option value="inactive">Inactive</option>

            </select>

            <select

              value={collectionStatusFilter}

              onChange={(event) => setCollectionStatusFilter(event.target.value)}

              className="h-10 px-3 border border-gray-300 rounded-lg bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"

              aria-label="Filter by collection status"

            >

              <option value="all">All Collection Status</option>

              {COLLECTION_STATUS_OPTIONS.map((option) => (

                <option key={option.value} value={option.value}>

                  {option.label}

                </option>

              ))}

            </select>

          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-4 pt-3 border-t border-gray-100">

            <div className="text-xs text-gray-500">

              Showing <span className="font-medium text-gray-700">{filteredBins.length}</span> of{" "}

              <span className="font-medium text-gray-700">{bins.length}</span> collection points

            </div>

            {hasActiveFilters && (

              <button

                type="button"

                onClick={clearFilters}

                className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900"

              >

                <RotateCcw className="size-3.5" />

                Clear filters

              </button>

            )}

          </div>

        </div>

        {/* BIN CARDS */}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

          {filteredBins.map((record) => {

            const bin =

              record as ExtendedBinRecord;

            const latitude =

              Number(bin.latitude);

            const longitude =

              Number(bin.longitude);

            const collectionStatus =

              bin.collection_status ??

              "pending";

            const isActive =

              (bin.status ?? "active").toLowerCase() === "active";
            const attention = attentionByBin.get(String(bin.id));
            const needsReview = Boolean(attention);

            return (

              <div

                key={bin.id}

                className={`rounded-lg shadow-sm border p-5 transition-all ${

                  needsReview
                    ? isActive
                      ? "bg-white border-amber-300 ring-1 ring-amber-100 hover:shadow-md"
                      : "bg-gray-50 border-amber-300 ring-1 ring-amber-100 opacity-90"
                    : isActive
                      ? "bg-white border-gray-200 hover:shadow-md"
                      : "bg-gray-50 border-gray-300 opacity-80"

                }`}

              >

                {/* CARD HEADER */}

                <div className="flex items-start justify-between mb-4">

                  <div className="flex items-start gap-3">

                    <div className="p-2 rounded-lg bg-emerald-50">

                      <MapPin className="size-5 text-emerald-700" />

                    </div>

                    <div className="flex-1">

                      <h3 className="text-gray-900">

                        {bin.code ??

                          bin.id}

                      </h3>

                      <div className="flex flex-wrap items-center gap-1.5 mt-1">

                        <span

                          className={`inline-flex px-2 py-0.5 rounded-full text-xs capitalize ${getTypeColor(

                            bin.type,

                          )}`}

                        >

                          {bin.type ??

                            "collection_site"}

                        </span>

                        <span

                          className={`inline-flex px-2 py-0.5 rounded-full text-xs capitalize ${getOperationalStatusColor(

                            bin.status,

                          )}`}

                        >

                          {bin.status ??

                            "active"}

                        </span>

                      </div>

                    </div>

                  </div>

                  {canMaintainCollectionPoints && (
                  <button

                    className={`p-1.5 rounded transition-colors ${

                      isActive

                        ? "text-amber-600 hover:bg-amber-50"

                        : "text-emerald-600 hover:bg-emerald-50"

                    }`}

                    onClick={() =>

                      setBinToToggle(

                        bin,

                      )

                    }

                    title={isActive ? "Disable collection point" : "Enable collection point"}

                  >

                    {isActive ? (

                      <PowerOff className="size-4" />

                    ) : (

                      <Power className="size-4" />

                    )}

                  </button>
                  )}

                </div>

                {needsReview && attention && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-xs font-medium text-amber-800">
                      <AlertTriangle className="size-4" />
                      Needs Attention
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {attention.collectionStatus === "missed" && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                          Missed collection
                        </span>
                      )}
                      {attention.collectionStatus === "delayed" && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                          Delayed collection
                        </span>
                      )}
                      {attention.inactive && (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
                          Inactive
                        </span>
                      )}
                      {attention.openIssues > 0 && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                          {attention.openIssues} open {attention.openIssues === 1 ? "issue" : "issues"}
                        </span>
                      )}
                      {attention.invalidBarangay && (
                        <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                          Barangay needs correction
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* LOCATION */}

                <div className="flex items-start gap-2">

                  <MapPin className="size-4 text-gray-400 mt-0.5 flex-shrink-0" />

                  <div>

                    <div className="text-sm text-gray-900">

                      {bin.location}

                    </div>

                    {(() => {
                      const barangay = (bin.barangay ?? "").trim();
                      const validBarangay = NAGA_CITY_BARANGAYS.some(
                        (officialBarangay) =>
                          officialBarangay.toLowerCase() === barangay.toLowerCase(),
                      );

                      if (validBarangay) {
                        return (
                          <div className="text-xs text-gray-500 mt-1">
                            Barangay {barangay}
                          </div>
                        );
                      }

                      return (
                        <div className="text-xs text-amber-700 mt-1 font-medium">
                          {barangay
                            ? `Saved barangay "${barangay}" is not a Naga City barangay — edit this point.`
                            : "Barangay not set — edit this point."}
                        </div>
                      );
                    })()}

                  </div>

                </div>

                {/* COLLECTION INFORMATION */}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-gray-200 mt-4 pt-4">

                  <div>

                    <div className="text-xs text-gray-500 mb-1">

                      Collection Status

                    </div>

                    <span

                      className={`inline-flex px-2 py-1 rounded-full text-xs ${getCollectionStatusColor(

                        collectionStatus,

                      )}`}

                    >

                      {formatCollectionStatus(

                        collectionStatus,

                      )}

                    </span>

                  </div>

                  <div>

                    <div className="text-xs text-gray-500 mb-1">

                      Last Collected

                    </div>

                    <div className="text-xs text-gray-900">

                      {bin.last_collected_at

                        ? formatDateTime(

                            bin.last_collected_at,

                          )

                        : "No collection record"}

                    </div>

                  </div>

                </div>

                {/* LAST UPDATED */}

                <div className="flex items-center gap-1.5 mt-4 text-xs text-gray-500">

                  <Clock3 className="size-3.5" />

                  <span>

                    Last updated:{" "}

                    {bin.updated_at

                      ? formatDateTime(

                          bin.updated_at,

                        )

                      : "Not available"}

                  </span>

                </div>

                {/* ACTIONS */}

                <div className="flex gap-2 mt-4">

                  {canMaintainCollectionPoints && (
                  <button

                    className={`px-3 py-2 text-sm rounded-lg transition-colors flex items-center justify-center gap-1.5 ${

                      isActive

                        ? "bg-amber-600 text-white hover:bg-amber-700"

                        : "bg-gray-200 text-gray-400 cursor-not-allowed"

                    }`}

                    disabled={!isActive}

                    onClick={() => {

                      setBinToMove(

                        bin,

                      );

                      setMoveForm({

                        location:

                          bin.location,

                        barangay:

                          bin.barangay ?? "",

                        type:

                          bin.type ?? "",

                        lat: String(

                          bin.latitude ??

                            "",

                        ),

                        lng: String(

                          bin.longitude ??

                            "",

                        ),

                      });

                      setFormError(

                        null,

                      );

                      setShowMoveLocationModal(

                        true,

                      );

                    }}

                    title={

                      isActive

                        ? "Edit collection point details"

                        : "Enable this collection point before editing it"

                    }

                  >

                    <Pencil className="size-3.5" />

                    <span>

                      Edit Point

                    </span>

                  </button>
                  )}

                  <button

                    className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"

                    onClick={() =>

                      handleViewMap(

                        bin,

                      )

                    }

                  >

                    View Details

                  </button>

                </div>

              </div>

            );

          })}

          {!loading && filteredBins.length === 0 && (

            <div className="col-span-full rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">

              {bins.length === 0

                ? "No collection points found yet."

                : "No collection points match your search or filters."}

            </div>

          )}

        </div>

      </div>

      {/* ADD BIN MODAL */}

      {showAddModal && canCreateCollectionPoints && (

        <div

          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300] p-4"

          onClick={() =>

            setShowAddModal(

              false,

            )

          }

        >

          <div

            className="bg-white p-6 rounded-lg shadow-lg w-full max-w-5xl max-h-[90vh] overflow-y-auto"

            onClick={(event) =>

              event.stopPropagation()

            }

          >

            <h3 className="text-gray-900 mb-1">

              Add Collection Point

            </h3>

            <p className="text-sm text-gray-600 mb-4">

              Register the collection point and pin its exact GPS location.

            </p>

            <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5">

              {/* FORM */}

              <div className="space-y-4">

                <input

                  value={

                    newBin.code

                  }

                  onChange={(

                    event,

                  ) =>

                    setNewBin({

                      ...newBin,

                      code: event

                        .target

                        .value,

                    })

                  }

                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"

                  placeholder="Collection Point ID"

                />

                <input

                  value={

                    newBin.location

                  }

                  onChange={(

                    event,

                  ) =>

                    setNewBin({

                      ...newBin,

                      location:

                        event

                          .target

                          .value,

                    })

                  }

                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"

                  placeholder="Location name or address"

                />

                {/* BARANGAY */}

                <CustomSelect

                  value={

                    newBin.barangay

                  }

                  onChange={(

                    barangay,

                  ) =>

                    setNewBin({

                      ...newBin,

                      barangay,

                    })

                  }

                  options={barangayOptions}

                  placeholder="Select barangay"

                  buttonClassName="h-10 px-3 bg-white border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"

                  ariaLabel="Barangay"

                />

                {/* TYPE */}

                <CustomSelect

                  value={

                    newBin.type

                  }

                  onChange={(

                    type,

                  ) =>

                    setNewBin({

                      ...newBin,

                      type,

                    })

                  }

                  options={activeBinTypes.map(

                    (type) => ({

                      value:

                        type,

                      label:

                        type,

                    }),

                  )}

                  placeholder="Select type"

                  buttonClassName="h-10 px-3 bg-white border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all capitalize"

                  ariaLabel="Collection point type"

                />

                {activeBinTypes.length === 0 && (
                  <p className="text-xs text-amber-700">
                    No active collection point types are configured in Supabase bin_types.
                  </p>
                )}

                {/* OPERATIONAL STATUS */}

                <CustomSelect

                  value={

                    newBin.operationalStatus

                  }

                  onChange={(

                    operationalStatus,

                  ) =>

                    setNewBin({

                      ...newBin,

                      operationalStatus,

                    })

                  }

                  options={

                    OPERATIONAL_STATUS_OPTIONS

                  }

                  placeholder="Operational status"

                  buttonClassName="h-10 px-3 bg-white border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"

                  ariaLabel="Operational status"

                />

                {/* COORDINATES */}

                <div className="grid grid-cols-2 gap-3">

                  <input

                    type="number"

                    step="any"

                    value={

                      newBin.lat

                    }

                    onChange={(

                      event,

                    ) =>

                      setNewBin({

                        ...newBin,

                        lat: event

                          .target

                          .value,

                      })

                    }

                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"

                    placeholder="Latitude"

                  />

                  <input

                    type="number"

                    step="any"

                    value={

                      newBin.lng

                    }

                    onChange={(

                      event,

                    ) =>

                      setNewBin({

                        ...newBin,

                        lng: event

                          .target

                          .value,

                      })

                    }

                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"

                    placeholder="Longitude"

                  />

                </div>

                <p className="text-xs text-gray-500">

                  Coordinates update automatically when you click or drag the pin. Manual coordinate edits move the pin in real time.

                </p>

                {formError && (

                  <p className="text-sm text-red-600">

                    {

                      formError

                    }

                  </p>

                )}

                {nearbyCollectionPointWarning && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 flex-shrink-0 text-amber-600" />
                      <div className="text-xs text-amber-800">
                        <div className="font-medium">Possible duplicate location</div>
                        <div className="mt-1">
                          {nearbyCollectionPointWarning.code} · {nearbyCollectionPointWarning.location} is about{" "}
                          {Math.max(1, Math.round(nearbyCollectionPointWarning.distanceMeters))} m away.
                        </div>
                        <div className="mt-1 text-amber-700">
                          Check the map before adding another collection point this close.
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleAddBin(true)}
                          className="mt-2 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 font-medium text-amber-800 hover:bg-amber-100"
                        >
                          Add Anyway
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* MAP */}

              <BinLocationPicker

                latitude={coordinateValue(

                  newBin.lat,

                )}

                longitude={coordinateValue(

                  newBin.lng,

                )}

                onChange={({

                  latitude,

                  longitude,

                }) =>

                  setNewBin(

                    (

                      previous,

                    ) => ({

                      ...previous,

                      lat: formatCoordinate(

                        latitude,

                      ),

                      lng: formatCoordinate(

                        longitude,

                      ),

                    }),

                  )

                }

                className="h-[480px] w-full"

              />

            </div>

            <div className="flex gap-3 mt-6">

              <button

                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"

                onClick={() => {
                  setShowAddModal(false);
                  setNearbyCollectionPointWarning(null);
                  setFormError(null);
                }}

              >

                Cancel

              </button>

              <button

                className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"

                onClick={() =>

                  void handleAddBin()

                }

              >

                Add Collection Point

              </button>

            </div>

          </div>

        </div>

      )}

      {/* VIEW MAP / DETAILS MODAL */}

      {showMapModal &&

        selectedBin && (

          <div

            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300] p-4"

            onClick={() =>

              setShowMapModal(

                false,

              )

            }

          >

            <div

              className="bg-white rounded-lg shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col"

              onClick={(

                event,

              ) =>

                event.stopPropagation()

              }

            >

              {/* HEADER */}

              <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-emerald-50 to-blue-50">

                <div className="flex items-center gap-3">

                  <div className="p-3 rounded-lg bg-green-100">

                    <MapPin className="size-6 text-green-600" />

                  </div>

                  <div>

                    <h3 className="text-gray-900">

                      {selectedBin.code ??

                        selectedBin.id}

                    </h3>

                    <p className="text-sm text-gray-600">

                      {

                        selectedBin.location

                      }

                    </p>

                    <div className="flex flex-wrap items-center gap-2 mt-2">

                      <span

                        className={`inline-flex px-2 py-0.5 rounded-full text-xs capitalize ${getTypeColor(

                          selectedBin.type,

                        )}`}

                      >

                        {selectedBin.type ??

                          "collection_site"}

                      </span>

                      <span

                        className={`inline-flex px-2 py-0.5 rounded-full text-xs capitalize ${getOperationalStatusColor(

                          selectedBin.status,

                        )}`}

                      >

                        {selectedBin.status ??

                          "active"}

                      </span>

                      <span

                        className={`inline-flex px-2 py-0.5 rounded-full text-xs ${getCollectionStatusColor(

                          selectedBin.collection_status,

                        )}`}

                      >

                        {formatCollectionStatus(

                          selectedBin.collection_status,

                        )}

                      </span>

                    </div>

                  </div>

                </div>

                <button

                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-white/50 rounded-lg"

                  onClick={() =>

                    setShowMapModal(

                      false,

                    )

                  }

                >

                  <X className="size-5" />

                </button>

              </div>

              <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

                {/* MAP */}

                <div className="flex-1 bg-gray-100 relative">

                  <BinLocationPicker

                    latitude={Number(

                      selectedBin.latitude,

                    )}

                    longitude={Number(

                      selectedBin.longitude,

                    )}

                    readOnly

                    className="absolute inset-0 h-full w-full rounded-none border-0"

                  />

                </div>

                {/* DETAILS */}

                <div className="w-full md:w-[420px] bg-white border-t md:border-t-0 md:border-l border-gray-200 flex flex-col overflow-y-auto">

                  <div className="p-6 border-b border-gray-200 bg-gray-50">

                    <div className="text-sm font-medium text-gray-700 mb-4">

                      Collection Point Details

                    </div>

                    <div className="space-y-4 text-sm">

                      <div>

                        <div className="text-gray-500 text-xs">

                          Address / Place

                        </div>

                        <div className="text-gray-900 mt-1">

                          {

                            selectedBin.location

                          }

                        </div>

                      </div>

                      <div>

                        <div className="text-gray-500 text-xs">

                          Barangay

                        </div>

                        <div className="text-gray-900 mt-1">

                          {selectedBin.barangay ??

                            "Not specified"}

                        </div>

                      </div>

                      <div>

                        <div className="text-gray-500 text-xs">

                          Operational Status

                        </div>

                        <span

                          className={`inline-flex mt-1 px-2 py-1 rounded-full text-xs capitalize ${getOperationalStatusColor(

                            selectedBin.status,

                          )}`}

                        >

                          {selectedBin.status ??

                            "active"}

                        </span>

                      </div>

                      <div>

                        <div className="text-gray-500 text-xs">

                          Collection Status

                        </div>

                        <span

                          className={`inline-flex mt-1 px-2 py-1 rounded-full text-xs ${getCollectionStatusColor(

                            selectedBin.collection_status,

                          )}`}

                        >

                          {formatCollectionStatus(

                            selectedBin.collection_status,

                          )}

                        </span>

                      </div>

                      <div>

                        <div className="text-gray-500 text-xs">

                          Coordinates

                        </div>

                        <div className="font-mono text-gray-900 mt-1">

                          {Number(

                            selectedBin.latitude,

                          ).toFixed(

                            6,

                          )}

                          ,{" "}

                          {Number(

                            selectedBin.longitude,

                          ).toFixed(

                            6,

                          )}

                        </div>

                      </div>

                    </div>

                  </div>

                  {/* COLLECTION INFO */}

                  <div className="p-6 border-b border-gray-200">

                    <div className="text-sm font-medium text-gray-700 mb-4">

                      Collection Activity

                    </div>

                    <div className="space-y-4">

                      <div className="flex items-start gap-3">

                        <CheckCircle2 className="size-5 text-emerald-500 mt-0.5" />

                        <div>

                          <div className="text-xs text-gray-500">

                            Last Collected

                          </div>

                          <div className="text-sm text-gray-900 mt-1">

                            {selectedBin.last_collected_at

                              ? formatDateTime(

                                  selectedBin.last_collected_at,

                                )

                              : "No collection record"}

                          </div>

                        </div>

                      </div>

                      <div className="flex items-start gap-3">

                        <Clock3 className="size-5 text-gray-400 mt-0.5" />

                        <div>

                          <div className="text-xs text-gray-500">

                            Last Updated

                          </div>

                          <div className="text-sm text-gray-900 mt-1">

                            {selectedBin.updated_at

                              ? formatDateTime(

                                  selectedBin.updated_at,

                                )

                              : "Not available"}

                          </div>

                        </div>

                      </div>

                    </div>

                  </div>

                  {/* CURRENT ROUTE / VEHICLE ASSIGNMENT */}

                  <div className="p-6 border-b border-gray-200">
                    <div className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
                      <Activity className="size-4 text-emerald-600" />
                      Current Assignment
                    </div>

                    {!selectedBinCurrentDelivery ? (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                        No active delivery is currently assigned to this collection point.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-3">
                          <div className="flex items-start gap-3">
                            <Route className="size-5 text-blue-500 mt-0.5" />
                            <div className="min-w-0">
                              <div className="text-xs text-gray-500">Assigned Route</div>
                              <div className="text-sm text-gray-900 mt-1 truncate">
                                {selectedBinCurrentRoute?.name ??
                                  `Route ${selectedBinCurrentDelivery.route_id}`}
                              </div>
                              {selectedBinStopPosition && (
                                <div className="text-xs text-gray-500 mt-1">
                                  Stop {selectedBinStopPosition.position} of {selectedBinStopPosition.total}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-start gap-3">
                            <UserRound className="size-5 text-indigo-500 mt-0.5" />
                            <div>
                              <div className="text-xs text-gray-500">Assigned Driver</div>
                              <div className="text-sm text-gray-900 mt-1">
                                {selectedBinCurrentDriver?.name ?? "Not assigned"}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-start gap-3">
                            <Truck className="size-5 text-amber-500 mt-0.5" />
                            <div>
                              <div className="text-xs text-gray-500">Assigned Truck</div>
                              <div className="text-sm text-gray-900 mt-1">
                                {selectedBinCurrentVehicle
                                  ? `${selectedBinCurrentVehicle.label || selectedBinCurrentVehicle.code} (${selectedBinCurrentVehicle.code})`
                                  : "Not assigned"}
                              </div>
                              {selectedBinCurrentVehicle?.status && (
                                <div className="text-xs text-gray-500 mt-1 capitalize">
                                  Status: {selectedBinCurrentVehicle.status.replaceAll("_", " ")}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {selectedBinRouteProgress && (
                          <div className="rounded-lg border border-gray-200 p-3">
                            <div className="flex items-center justify-between text-xs mb-2">
                              <span className="text-gray-600 flex items-center gap-1.5">
                                <Gauge className="size-4" />
                                Route Progress
                              </span>
                              <span className="font-medium text-gray-900">
                                {selectedBinRouteProgress.completed}/{selectedBinRouteProgress.total} stops · {selectedBinRouteProgress.percent}%
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full transition-all"
                                style={{ width: `${selectedBinRouteProgress.percent}%` }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="rounded-lg border border-gray-200 p-3">
                          <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
                            <Radio className="size-4 text-emerald-600" />
                            Vehicle GPS
                          </div>
                          {selectedVehicleLiveLocation ? (
                            <div className="space-y-1">
                              <div className="text-sm text-gray-900 font-mono">
                                {Number(selectedVehicleLiveLocation.latitude).toFixed(6)}, {Number(selectedVehicleLiveLocation.longitude).toFixed(6)}
                              </div>
                              <div className="text-xs text-gray-500">
                                Last GPS update: {formatDateTime(
                                  selectedVehicleLiveLocation.updated_at ??
                                    selectedVehicleLiveLocation.recorded_at ??
                                    null,
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500">
                              No recent GPS position is available for the assigned truck.
                            </div>
                          )}
                        </div>

                        {onNavigate && (
                          <button
                            onClick={() => {
                              setShowMapModal(false);
                              onNavigate("vehicle-monitoring");
                            }}
                            className="w-full px-4 py-2.5 border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 flex items-center justify-center gap-2"
                          >
                            <Truck className="size-4" />
                            Open Vehicle Monitoring
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ACTIONS */}

                  <div className="p-6 space-y-4">

                    <div className="text-sm text-gray-700 flex items-center gap-2">

                      <Pencil className="size-4 text-gray-400" />

                      Use Edit Point to update the address, barangay, type, or GPS position for this collection point.

                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      <button
                        onClick={() => setShowHistoryModal(true)}
                        className="w-full px-4 py-2.5 border border-gray-300 bg-white text-gray-700 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2"
                      >
                        <History className="size-4" />
                        Collection History
                      </button>

                      {canReportIssues && (
                        <button
                          onClick={() => openReportIssue(selectedBin)}
                          className="w-full px-4 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center justify-center gap-2"
                        >
                          <FileWarning className="size-4" />
                          Report Issue
                        </button>
                      )}
                    </div>

                    <button

                      onClick={() =>

                        window.open(

                          `https\://www.google.com/maps?q=${Number(

                            selectedBin.latitude,

                          )},${Number(

                            selectedBin.longitude,

                          )}`,

                          "_blank",

                        )

                      }

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

      {/* COLLECTION HISTORY MODAL */}

      {showHistoryModal && selectedBin && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[350] p-4"
          onClick={() => setShowHistoryModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h3 className="text-gray-900">Collection History</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedBin.code ?? selectedBin.id} · {selectedBin.location}
                </p>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[65vh]">
              {selectedBinHistory.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
                  No collection history recorded for this collection point yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedBinHistory.map((delivery) => {
                    const driver = delivery.driver_id != null ? driverById.get(String(delivery.driver_id)) : undefined;
                    const route = routeById.get(String(delivery.route_id));
                    const status = (delivery.status ?? "pending").replaceAll("_", " ");
                    return (
                      <div key={delivery.id} className="rounded-lg border border-gray-200 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-medium text-gray-900 capitalize">{status}</div>
                            <div className="text-sm text-gray-600 mt-1">
                              {delivery.completed_at
                                ? formatDateTime(delivery.completed_at)
                                : delivery.updated_at
                                  ? formatDateTime(delivery.updated_at)
                                  : "Date not recorded"}
                            </div>
                          </div>
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs ${
                            status === "completed" || status === "collected"
                              ? "bg-emerald-100 text-emerald-700"
                              : status === "missed"
                                ? "bg-red-100 text-red-700"
                                : "bg-gray-100 text-gray-700"
                          }`}>
                            {status}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 text-sm">
                          <div>
                            <div className="text-xs text-gray-500">Schedule / Route</div>
                            <div className="text-gray-800 mt-1">{route?.name ?? delivery.route_id ?? "Not recorded"}</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">Driver</div>
                            <div className="text-gray-800 mt-1">{driver?.name ?? "Not recorded"}</div>
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              )}

              {selectedBinReports.length > 0 && (
                <div className="mt-6 border-t border-gray-200 pt-5">
                  <div className="text-sm font-medium text-gray-700 mb-3">Related Issue Reports</div>
                  <div className="space-y-2">
                    {selectedBinReports.slice(0, 5).map((report) => (
                      <div key={report.id} className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm text-gray-900 capitalize">
                            {(report.report_type ?? report.type ?? "issue").replaceAll("_", " ")}
                          </div>
                          <span className="text-xs text-gray-500 capitalize">{report.status}</span>
                        </div>
                        {report.description && <div className="text-xs text-gray-600 mt-1">{report.description}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* REPORT ISSUE MODAL */}

      {showReportModal && reportBin && canReportIssues && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[360] p-4"
          onClick={() => setShowReportModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h3 className="text-gray-900">Report Collection Point Issue</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {reportBin.code ?? reportBin.id} · {reportBin.location}
                </p>
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Issue Type</label>
                  <CustomSelect
                    value={reportForm.type}
                    onChange={(type) => setReportForm((previous) => ({ ...previous, type }))}
                    options={ISSUE_TYPE_OPTIONS}
                    placeholder="Select issue type"
                    buttonClassName="h-10 px-3 bg-white border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    ariaLabel="Issue type"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-700 mb-2">Priority</label>
                  <CustomSelect
                    value={reportForm.priority}
                    onChange={(priority) => setReportForm((previous) => ({ ...previous, priority }))}
                    options={ISSUE_PRIORITY_OPTIONS}
                    placeholder="Select priority"
                    buttonClassName="h-10 px-3 bg-white border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    ariaLabel="Issue priority"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-700 mb-2">Notes</label>
                <textarea
                  value={reportForm.description}
                  onChange={(event) => setReportForm((previous) => ({ ...previous, description: event.target.value }))}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Describe what happened, what you observed, and any action already taken..."
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className="block text-sm text-gray-700">Photo</label>
                  <span className="text-xs text-gray-500">Optional · JPG/PNG/WebP · Max 5 MB</span>
                </div>

                {!reportPhotoPreview ? (
                  <label className="flex items-center justify-center gap-2 w-full min-h-24 px-4 py-4 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-emerald-400 hover:bg-emerald-50/40 cursor-pointer transition-colors">
                    <ImagePlus className="size-5" />
                    <span>Select or capture a photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleReportPhotoChange}
                      className="hidden"
                    />
                  </label>
                ) : (
                  <div className="relative rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                    <img
                      src={reportPhotoPreview}
                      alt="Issue report preview"
                      className="w-full max-h-64 object-contain"
                    />
                    <button
                      type="button"
                      onClick={clearReportPhoto}
                      className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/95 border border-gray-200 rounded-lg text-xs text-red-600 shadow-sm hover:bg-red-50"
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm text-gray-800">
                        <LocateFixed className="size-4 text-emerald-600" />
                        GPS Location
                      </div>
                      <div className="text-xs text-gray-600 mt-2 font-mono">
                        {reportGps.latitude != null && reportGps.longitude != null
                          ? `${reportGps.latitude.toFixed(6)}, ${reportGps.longitude.toFixed(6)}`
                          : "No coordinates available"}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {reportGps.source === "device" ? "Current device location" : "Saved collection-point location"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void captureReportGps(reportBin)}
                      disabled={reportGpsLoading}
                      className="shrink-0 px-3 py-1.5 text-xs border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {reportGpsLoading ? "Locating..." : "Refresh GPS"}
                    </button>
                  </div>
                  {reportGpsMessage && (
                    <div className="text-xs text-gray-500 mt-2">{reportGpsMessage}</div>
                  )}
                </div>

                <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
                  <div className="flex items-center gap-2 text-sm text-gray-800">
                    <Clock3 className="size-4 text-blue-600" />
                    Report Timestamp
                  </div>
                  <div className="text-sm text-gray-700 mt-2">
                    {reportTimestamp ? formatDateTime(reportTimestamp) : "Not recorded"}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Captured automatically when the report form is opened.</div>
                </div>
              </div>

              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex gap-2">
                <Camera className="size-4 shrink-0 mt-0.5" />
                <span>Collection point ID, GPS coordinates, timestamp, notes, priority, issue type, and the optional photo will be stored with this report.</span>
              </div>

              {formError && <p className="text-sm text-red-600">{formError}</p>}
              {reportSuccess && <p className="text-sm text-emerald-600">{reportSuccess}</p>}
            </div>

            <div className="flex gap-3 p-6 border-t border-gray-200">
              <button
                onClick={() => setShowReportModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
              <button
                onClick={() => void handleSubmitIssue()}
                disabled={reportSubmitting || reportGpsLoading}
                className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Send className="size-4" />
                {reportSubmitting ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT COLLECTION POINT MODAL */}

      {showMoveLocationModal &&

        binToMove && (

          <div

            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300] p-4"

            onClick={() =>

              setShowMoveLocationModal(

                false,

              )

            }

          >

            <div

              className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"

              onClick={(

                event,

              ) =>

                event.stopPropagation()

              }

            >

              <div className="flex items-center justify-between p-6 border-b border-gray-200">

                <div className="flex items-center gap-3">

                  <div className="p-2 bg-amber-100 rounded-lg">

                    <Pencil className="size-6 text-amber-600" />

                  </div>

                  <div>

                    <h3 className="font-['Poppins:SemiBold',sans-serif] text-gray-900">

                      Edit Collection Point

                    </h3>

                    <p className="font-['Poppins:Regular',sans-serif] text-sm text-gray-600">

                      Update{" "}

                      {binToMove.code ??

                        binToMove.id}

                    </p>

                  </div>

                </div>

                <button

                  onClick={() =>

                    setShowMoveLocationModal(

                      false,

                    )

                  }

                  className="text-gray-400 hover:text-gray-600"

                >

                  <X className="size-6" />

                </button>

              </div>

              <div className="p-6 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">

                <div className="space-y-4">

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Collection Point ID
                    </label>
                    <input
                      value={String(binToMove.code ?? binToMove.id)}
                      readOnly
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      The collection point ID cannot be changed here.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Location Name / Address
                    </label>
                    <input

                      value={

                        moveForm.location

                      }

                      onChange={(

                        event,

                      ) =>

                        setMoveForm(

                          (

                            previous,

                          ) => ({

                            ...previous,

                            location:

                              event

                                .target

                                .value,

                          }),

                        )

                      }

                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"

                      placeholder="Location name or address"

                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Barangay
                    </label>
                    <CustomSelect
                      value={moveForm.barangay}
                      onChange={(barangay) =>
                        setMoveForm((previous) => ({
                          ...previous,
                          barangay,
                        }))
                      }
                      options={availableBarangays.map((barangay) => ({
                        value: barangay,
                        label: barangay,
                      }))}
                      placeholder="Select barangay"
                      buttonClassName="h-10 px-3 bg-white border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                      ariaLabel="Edit collection point barangay"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Collection Point Type
                    </label>
                    <CustomSelect
                      value={moveForm.type}
                      onChange={(type) =>
                        setMoveForm((previous) => ({
                          ...previous,
                          type,
                        }))
                      }
                      options={availableTypes.map((type) => ({
                        value: type,
                        label: type,
                      }))}
                      placeholder="Select type"
                      buttonClassName="h-10 px-3 bg-white border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all capitalize"
                      ariaLabel="Edit collection point type"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Latitude
                      </label>
                      <input

                        type="number"

                        step="any"

                        value={

                          moveForm.lat

                        }

                      onChange={(

                        event,

                      ) =>

                        setMoveForm(

                          (

                            previous,

                          ) => ({

                            ...previous,

                            lat: event

                              .target

                              .value,

                          }),

                        )

                      }

                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"

                        placeholder="Latitude"

                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Longitude
                      </label>
                      <input

                        type="number"

                      step="any"

                      value={

                        moveForm.lng

                      }

                      onChange={(

                        event,

                      ) =>

                        setMoveForm(

                          (

                            previous,

                          ) => ({

                            ...previous,

                            lng: event

                              .target

                              .value,

                          }),

                        )

                      }

                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"

                        placeholder="Longitude"

                      />
                    </div>

                  </div>

                  <p className="text-xs text-gray-500">

                    Update the address, barangay, type, or GPS position. Drag the pin or click a new point on the map to change the coordinates.

                  </p>

                  {formError && (

                    <p className="text-sm text-red-600">

                      {

                        formError

                      }

                    </p>

                  )}

                </div>

                <BinLocationPicker

                  latitude={coordinateValue(

                    moveForm.lat,

                  )}

                  longitude={coordinateValue(

                    moveForm.lng,

                  )}

                  onChange={({

                    latitude,

                    longitude,

                  }) =>

                    setMoveForm(

                      (

                        previous,

                      ) => ({

                        ...previous,

                        lat: formatCoordinate(

                          latitude,

                        ),

                        lng: formatCoordinate(

                          longitude,

                        ),

                      }),

                    )

                  }

                  className="h-[380px] w-full"

                />

              </div>

              <div className="flex gap-3 p-6 border-t border-gray-200">

                <button

                  onClick={() =>

                    setShowMoveLocationModal(

                      false,

                    )

                  }

                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"

                >

                  Cancel

                </button>

                <button

                  onClick={() =>

                    void handleMoveBin()

                  }

                  className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700"

                >

                  Save Changes

                </button>

              </div>

            </div>

          </div>

        )}

      {/* DISABLE / ENABLE CONFIRMATION */}

      <ConfirmModal

        isOpen={Boolean(

          binToToggle,

        )}

        onClose={() =>

          setBinToToggle(null)

        }

        onConfirm={() =>

          void handleToggleBinStatus()

        }

        title={

          (binToToggle?.status ?? "active").toLowerCase() === "active"

            ? "Disable Collection Point"

            : "Enable Collection Point"

        }

        message={

          (binToToggle?.status ?? "active").toLowerCase() === "active"

            ? `${binToToggle?.code ?? "This collection point"} will become inactive and will not be available for active collection operations. Historical records will be preserved.`

            : `${binToToggle?.code ?? "This collection point"} will become active and available for collection operations again.`

        }

        variant="danger"

        confirmText={

          (binToToggle?.status ?? "active").toLowerCase() === "active"

            ? "Disable"

            : "Enable"

        }

      />

    </div>

  );

}
