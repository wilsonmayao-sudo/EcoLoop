import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as FileSystem from "expo-file-system/legacy";
import NetInfo from "@react-native-community/netinfo";
import { decode as decodeBase64 } from "base64-arraybuffer";
import Header from "../components/ui/Header";
import TagChip from "../components/ui/TagChip";
import AppButton from "../components/ui/AppButton";
import SurfaceCard from "../components/ui/SurfaceCard";
import { useTheme } from "../context/ThemeContext";
import { useCompletedRoutes } from "../context/CompletedRoutesContext";
import { usePickups } from "../context/PickupContext";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { enqueueMutation, flushOfflineQueue, subscribeConnectivity } from "../services/offlineSync";

const DEFAULT_PROBLEM_TYPES = [
  "Flat tire",
  "Fuel issue",
  "Traffic congestion",
  "Route blocked",
  "Accident",
  "Missed collection",
  "Flooded",
  "Other",
];

const EXCLUDED_PROBLEM_TYPES = new Set([
  "bin overflow",
  "schedule request",
  "truck breakdown",
]);

const STAFF_REPORT_NOTIFICATION_ROLES = ["admin", "supervisor"];

function normalizeStatus(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "_");
}

function reportDisplayNumber(report) {
  return report?.report_number ?? report?.report_id ?? "New report";
}

function reportNotificationMessage(payload) {
  const driverName = payload.reported_by || "A truck driver";
  const category = payload.report_type || payload.type || "an issue";
  const location = payload.location && payload.location !== "Not specified" ? ` at ${payload.location}` : "";
  return `${driverName} submitted ${category}${location}. Open Reports & Issues to review.`;
}

async function notifyStaffOfNewReport(report, payload) {
  const sourceId = report?.id ? String(report.id) : null;
  const title = `New report: ${reportDisplayNumber(report)}`;
  const message = reportNotificationMessage(payload);
  const { error } = await supabase.from("notifications").insert(
    STAFF_REPORT_NOTIFICATION_ROLES.map((role) => ({
      role,
      title,
      message,
      type: "warning",
      category: "report",
      source_table: "waste_reports",
      source_id: sourceId,
      read: false,
    })),
  );
  if (error) throw error;
}

function formatDateTime(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function userFriendlyError(error) {
  const message = String(error?.message ?? error ?? "Unknown error");
  const lower = message.toLowerCase();
  if (lower.includes("network request failed")) return "Unable to reach server. Please check your internet connection.";
  if (lower.includes("bucket") || lower.includes("storage")) return "Image upload failed. Please try again or submit without image.";
  if (lower.includes("row-level security") || lower.includes("permission denied")) return "You don't have permission to submit reports yet. Please contact admin.";
  if (lower.includes("jwt") || lower.includes("session")) return "Your session expired. Please log in again.";
  return message;
}

export default function ReportsScreen() {
  const { colors, tokens } = useTheme();
  const { driver } = useAuth();
  const { completedRoutes } = useCompletedRoutes();
  const { pendingPickups, getCompletedPickups, getRemainingPickups, getTotalPickups } = usePickups();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categories, setCategories] = useState([]);
  const [reports, setReports] = useState([]);

  const [showCreate, setShowCreate] = useState(false);
  const [showTypeOptions, setShowTypeOptions] = useState(false);
  const [newType, setNewType] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newLat, setNewLat] = useState(null);
  const [newLng, setNewLng] = useState(null);
  const [photoUri, setPhotoUri] = useState("");

  const problemTypeOptions = useMemo(() => {
    const dynamic = (categories ?? []).map((c) => String(c).trim()).filter(Boolean);
    const dedup = new Map();
    [...dynamic, ...DEFAULT_PROBLEM_TYPES].forEach((item) => {
      const key = item.toLowerCase();
      if (EXCLUDED_PROBLEM_TYPES.has(key)) return;
      if (!dedup.has(key)) dedup.set(key, item);
    });
    const options = Array.from(dedup.values());
    const nonOther = options.filter((item) => item.toLowerCase() !== "other");
    const hasOther = options.some((item) => item.toLowerCase() === "other");
    return hasOther ? [...nonOther, "Other"] : nonOther;
  }, [categories]);

  const load = useCallback(async () => {
    if (!driver?.id) return;
    setLoading(true);
    setError("");
    const [catsResult, reportsResult] = await Promise.all([
      supabase.from("report_categories").select("name").eq("is_active", true).order("sort_order", { ascending: true }),
      supabase
        .from("waste_reports")
        .select("id, report_id, report_number, report_type, type, description, image_url, latitude, longitude, location, route_id, status, created_at")
        .eq("driver_id", String(driver.id))
        .order("created_at", { ascending: false }),
    ]);
    if (catsResult.error) setError(catsResult.error.message);
    if (reportsResult.error) setError((prev) => prev || reportsResult.error.message);
    setCategories((catsResult.data ?? []).map((item) => item.name));
    setReports(reportsResult.data ?? []);
    setLoading(false);
  }, [driver?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!driver?.id) return undefined;
    const channel = supabase
      .channel(`mobile-reports-${driver.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "waste_reports", filter: `driver_id=eq.${driver.id}` }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id, load]);

  const stats = useMemo(() => {
    const pendingReports = reports.filter((item) => normalizeStatus(item.status) !== "resolved").length;
    return {
      pickups: `${getCompletedPickups()}/${getTotalPickups()}`,
      remaining: `${getRemainingPickups()}`,
      completedRoutes: `${(completedRoutes ?? []).length}`,
      pendingReports: `${pendingReports}`,
    };
  }, [completedRoutes, getCompletedPickups, getRemainingPickups, getTotalPickups, reports]);

  const filteredReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) =>
      [r.report_id, r.report_number, r.report_type, r.type, r.location, r.description, r.status].some((v) =>
        String(v ?? "").toLowerCase().includes(q),
      ),
    );
  }, [reports, searchQuery]);

  const captureCurrentLocation = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission required", "Enable location permissions to capture GPS.");
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const lat = Number(pos.coords.latitude.toFixed(6));
    const lng = Number(pos.coords.longitude.toFixed(6));
    setNewLat(lat);
    setNewLng(lng);
    try {
      const geocoded = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      const first = geocoded?.[0];
      if (first) {
        const label = [first.name, first.street, first.city, first.region].filter(Boolean).join(", ");
        if (label) setNewLocation(label);
      }
    } catch {}
  }, []);

  const pickPhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission required", "Enable media permission to attach images.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!picked.canceled && picked.assets?.[0]?.uri) setPhotoUri(picked.assets[0].uri);
  }, []);

  const uploadImage = useCallback(async () => {
    if (!photoUri || !driver?.id) return null;
    const path = `driver-${driver.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const base64 = await FileSystem.readAsStringAsync(photoUri, {
      encoding: "base64",
    });
    const arrayBuffer = decodeBase64(base64);
    const uploaded = await supabase.storage.from("report-images").upload(path, arrayBuffer, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (uploaded.error) throw uploaded.error;
    const { data } = supabase.storage.from("report-images").getPublicUrl(path);
    return data.publicUrl;
  }, [driver?.id, photoUri]);

  const executeQueuedMutation = useCallback(async (mutation) => {
    if (mutation.type !== "CREATE_REPORT") return;
    let imageUrl = mutation.payload.image_url ?? null;
    if (mutation.photoUri) {
      const path = `driver-${driver?.id ?? mutation.payload.driver_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const base64 = await FileSystem.readAsStringAsync(mutation.photoUri, {
        encoding: "base64",
      });
      const arrayBuffer = decodeBase64(base64);
      const uploaded = await supabase.storage.from("report-images").upload(path, arrayBuffer, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (uploaded.error) throw uploaded.error;
      imageUrl = supabase.storage.from("report-images").getPublicUrl(path).data.publicUrl;
    }
    const { data: insertedReport, error: insErr } = await supabase
      .from("waste_reports")
      .insert({ ...mutation.payload, image_url: imageUrl })
      .select("id, report_id, report_number")
      .single();
    if (insErr) throw insErr;
    try {
      await notifyStaffOfNewReport(insertedReport, mutation.payload);
    } catch (notifyErr) {
      console.warn("Report notification failed:", notifyErr?.message ?? notifyErr);
    }
  }, [driver?.id]);

  useEffect(() => {
    let cleanup = () => {};
    const boot = async () => {
      await flushOfflineQueue(executeQueuedMutation);
      cleanup = subscribeConnectivity(executeQueuedMutation);
    };
    boot();
    return () => cleanup();
  }, [executeQueuedMutation]);

  const submit = useCallback(async () => {
    if (!driver?.id) return;
    if (!newType.trim() || !newDescription.trim()) {
      Alert.alert("Missing fields", "Problem type and notes are required.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const routeId = pendingPickups?.[0]?.routeId ? String(pendingPickups[0].routeId) : null;
      const reportType = newType.trim();
      const payload = {
        driver_id: String(driver.id),
        route_id: routeId,
        report_type: reportType,
        type: reportType,
        description: newDescription.trim(),
        image_url: null,
        latitude: newLat,
        longitude: newLng,
        location: newLocation.trim() || (newLat && newLng ? `${newLat}, ${newLng}` : "Not specified"),
        status: "pending",
        priority: "medium",
        reported_by: driver.name ?? null,
      };
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        await enqueueMutation({
          type: "CREATE_REPORT",
          payload,
          photoUri: photoUri || null,
        });
        Alert.alert("Saved offline", "Report queued. It will be submitted when internet is available.");
      } else {
        let imageUrl = null;
        if (photoUri) imageUrl = await uploadImage();
        const { data: insertedReport, error: insErr } = await supabase
          .from("waste_reports")
          .insert({
            ...payload,
            image_url: imageUrl,
          })
          .select("id, report_id, report_number")
          .single();
        if (insErr) throw insErr;
        try {
          await notifyStaffOfNewReport(insertedReport, payload);
        } catch (notifyErr) {
          console.warn("Report notification failed:", notifyErr?.message ?? notifyErr);
        }
      }
      setShowCreate(false);
      setShowTypeOptions(false);
      setNewType("");
      setNewDescription("");
      setNewLocation("");
      setNewLat(null);
      setNewLng(null);
      setPhotoUri("");
      await load();
      if (netState.isConnected) {
        Alert.alert("Submitted", "Report successfully saved.");
      }
    } catch (e) {
      const friendly = userFriendlyError(e);
      console.error("Report submit failed:", {
        message: e?.message,
        details: e,
      });
      setError(friendly);
      Alert.alert("Submit failed", friendly);
    } finally {
      setLoading(false);
    }
  }, [driver?.id, driver?.name, load, newDescription, newLat, newLng, newLocation, newType, pendingPickups, uploadImage]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={["top"]}>
      <Header
        title="Overall Report"
        rightIcons={[
          { name: showSearch ? "close" : "search", onPress: () => setShowSearch((prev) => !prev), active: showSearch },
          { name: "refresh", onPress: () => void load() },
        ]}
      />

      {showSearch ? (
        <View style={[styles.searchContainer, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search reports..."
            placeholderTextColor={colors.textSecondary + "88"}
          />
        </View>
      ) : null}

      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, { gap: tokens.space.lg }]}>
        <SurfaceCard elevated={false}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary, marginBottom: tokens.space.md }]}>Daily collection summary</Text>
          <View style={styles.statsRow}>
            <StatMini label="Pickups" value={stats.pickups} colors={colors} />
            <StatMini label="Remaining" value={stats.remaining} colors={colors} />
            <StatMini label="Pending reports" value={stats.pendingReports} colors={colors} />
            <StatMini label="Routes done" value={stats.completedRoutes} colors={colors} />
          </View>
        </SurfaceCard>

        <SurfaceCard elevated={false}>
          <View style={[styles.rowBetween, { marginBottom: tokens.space.md }]}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary, flex: 1, marginRight: 8, marginBottom: 0 }]}>Operational reports</Text>
            <AppButton
              title="New"
              icon="add"
              onPress={() => {
                setNewType(problemTypeOptions[0] ?? "Truck breakdown");
                setShowCreate(true);
              }}
              fullWidth={false}
              style={styles.newReportBtn}
            />
          </View>

          {filteredReports.length === 0 ? <Text style={[styles.helper, { color: colors.textSecondary }]}>No reports yet.</Text> : null}
          {filteredReports.map((item, index) => (
            <View
              key={item.id}
              style={[
                styles.reportTile,
                { borderColor: colors.borderSubtle },
                index > 0 ? { marginTop: tokens.space.md } : null,
              ]}
            >
              <View style={styles.rowBetween}>
                <Text style={[styles.reportTitle, { color: colors.textPrimary }]}>{item.report_id ?? item.report_number ?? "Report"}</Text>
                <TagChip
                  label={normalizeStatus(item.status) === "resolved" ? "Resolved" : "Pending"}
                  color={normalizeStatus(item.status) === "resolved" ? colors.pillGreen : colors.pillBlue}
                />
              </View>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{item.report_type ?? item.type}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{item.location}</Text>
              {item.latitude != null && item.longitude != null ? (
                <Text style={[styles.meta, { color: colors.textSecondary }]}>GPS: {Number(item.latitude).toFixed(6)}, {Number(item.longitude).toFixed(6)}</Text>
              ) : null}
              {item.image_url ? <Image source={{ uri: item.image_url }} style={styles.reportImage} /> : null}
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{formatDateTime(item.created_at)}</Text>
              <Text style={[styles.description, { color: colors.textPrimary }]} numberOfLines={4}>{item.description}</Text>
            </View>
          ))}
        </SurfaceCard>
      </ScrollView>

      {showCreate ? (
        <View style={[styles.modalOverlay, { backgroundColor: "#00000066" }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Submit Overall Report</Text>
              <TouchableOpacity onPress={() => setShowCreate(false)}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.label, { color: colors.textSecondary }]}>Problem Type</Text>
            <TouchableOpacity style={[styles.input, styles.dropdown, { borderColor: colors.textSecondary + "33" }]} onPress={() => setShowTypeOptions((v) => !v)}>
              <Text style={{ color: colors.textPrimary, flex: 1 }}>{newType || "Select type"}</Text>
              <Ionicons name={showTypeOptions ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            {showTypeOptions ? (
              <View style={[styles.dropdownList, { borderColor: colors.textSecondary + "33", backgroundColor: colors.surface }]}>
                {problemTypeOptions.map((cat) => (
                  <TouchableOpacity key={cat} style={styles.dropdownItem} onPress={() => { setNewType(cat); setShowTypeOptions(false); }}>
                    <Text style={{ color: colors.textPrimary }}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            <Text style={[styles.label, { color: colors.textSecondary }]}>Current location / GPS</Text>
            <AppButton title="Use current location" variant="outline" onPress={() => void captureCurrentLocation()} />
            <TextInput
              style={[styles.input, { borderColor: colors.textSecondary + "33", color: colors.textPrimary }]}
              value={newLocation}
              onChangeText={setNewLocation}
              placeholder="Location details"
              placeholderTextColor={colors.textSecondary + "88"}
            />
            {newLat != null && newLng != null ? <Text style={[styles.helper, { color: colors.textSecondary }]}>GPS: {newLat.toFixed(6)}, {newLng.toFixed(6)}</Text> : null}

            <Text style={[styles.label, { color: colors.textSecondary }]}>Photo attachment</Text>
            <View style={[styles.rowBetween, { alignItems: "stretch" }]}>
              <AppButton
                title={photoUri ? "Change photo" : "Upload photo"}
                variant="outline"
                onPress={() => void pickPhoto()}
                fullWidth={false}
                style={{ flex: 1, marginRight: photoUri ? tokens.space.sm : 0 }}
              />
              {photoUri ? (
                <AppButton
                  title="Remove"
                  variant="outline"
                  onPress={() => setPhotoUri("")}
                  fullWidth={false}
                  style={{ flex: 0, minWidth: 100, borderColor: colors.danger }}
                  textStyle={{ color: colors.danger }}
                />
              ) : null}
            </View>
            {photoUri ? <Image source={{ uri: photoUri }} style={styles.previewImage} /> : null}

            <Text style={[styles.label, { color: colors.textSecondary }]}>Reporting Details / Notes</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline, { borderColor: colors.textSecondary + "33", color: colors.textPrimary }]}
              value={newDescription}
              onChangeText={setNewDescription}
              placeholder="Describe issue and notes..."
              placeholderTextColor={colors.textSecondary + "88"}
              multiline
            />

            <View style={[styles.rowBetween, { gap: tokens.space.sm, marginTop: tokens.space.md }]}>
              <AppButton title="Cancel" variant="outline" onPress={() => setShowCreate(false)} fullWidth={false} style={{ flex: 1 }} />
              <AppButton
                title={loading ? "Submitting…" : "Submit report"}
                onPress={() => void submit()}
                disabled={loading}
                loading={loading}
                fullWidth={false}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      ) : null}

      {error ? (
        <View style={[styles.errorBox, { borderColor: colors.danger + "55", backgroundColor: colors.danger + "10" }]}>
          <Text style={{ color: colors.danger }}>{error}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function StatMini({ label, value, colors }) {
  return (
    <View style={[styles.statContainer, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
      <Text style={[styles.statValue, { color: colors.textPrimary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 },
  newReportBtn: {
    minWidth: 88,
    paddingHorizontal: 14,
    alignSelf: "center",
  },
  sectionTitle: { fontSize: 16, fontWeight: "800" },
  helper: { fontSize: 12 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  statsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  statContainer: { minWidth: "47%", flexGrow: 1, paddingVertical: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  statValue: { fontSize: 16, fontWeight: "800" },
  statLabel: { fontSize: 11, marginTop: 2, textAlign: "center" },
  reportTile: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 4 },
  reportTitle: { fontSize: 13, fontWeight: "800" },
  meta: { fontSize: 12 },
  description: { fontSize: 13, marginTop: 2 },
  reportImage: { width: "100%", height: 130, borderRadius: 10, marginTop: 4 },
  previewImage: { width: "100%", height: 130, borderRadius: 10 },
  searchContainer: {
    marginHorizontal: 20,
    marginTop: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14 },
  modalOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", padding: 16 },
  modalCard: { borderRadius: 16, padding: 16, gap: 10, maxHeight: "92%" },
  label: { fontSize: 12, fontWeight: "700", marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  inputMultiline: { minHeight: 90, textAlignVertical: "top" },
  dropdown: { flexDirection: "row", alignItems: "center" },
  dropdownList: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  dropdownItem: { paddingHorizontal: 10, paddingVertical: 9 },
  errorBox: { position: "absolute", left: 16, right: 16, bottom: 16, borderWidth: 1, borderRadius: 10, padding: 10 },
});

