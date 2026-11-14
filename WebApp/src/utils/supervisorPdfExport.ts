import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import nagaOfficialSealUrl from "../assets/images/naga-official-seal.jpg";
import swmoLogoUrl from "../assets/images/swmo-logo.jpg";
import { normalizeStatus } from "../hooks/useLiveData";
import {
  formatPhilippineDateTime,
  formatRangeLabel,
  getDateRange,
  type DateRange,
  type ReportPeriod,
} from "./reportDateRange";
import {
  buildCollectionActivityReportData,
  buildDriverPerformanceRows,
  buildEnrichedRouteReports,
  buildFleetMonitoringRows,
  fetchSupervisorExportData,
  filterDeliveriesForRange,
  filterReportsForRange,
  formatReportType,
  formatVehicleTitle,
  formatVehicleType,
  labelDriverStatus,
  labelReportStatus,
  type CollectionActivityDetailRow,
  type CollectionActivityScheduleSummary,
  type EnrichedRouteReportRow,
  type FleetMonitoringExportRow,
  type MissedOrIssueExportRow,
  type SupervisorExportData,
  type SupervisorExportDriver,
  type SupervisorExportVehicle,
} from "./supervisorExportData";
import { normalizeScheduleDayFilter } from "./scheduleDays";

export type DispatcherPdfReportType = "driver" | "route" | "fleet" | "activity";

export interface ExportSupervisorPdfOptions {
  reportType?: DispatcherPdfReportType;
  supervisorName: string;
  supervisorRoleLabel?: string;
  driverId?: string;
  period: ReportPeriod;
  customStart?: string;
  customEnd?: string;
  scheduleDay?: string;
  routeStatus?: string;
  areaCode?: string;
  fleetStatus?: string;
}

export interface BrandLogoAsset {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  alias: string;
}

export interface LoadedBrandLogos {
  nagaSeal: BrandLogoAsset | null;
  swmoLogo: BrandLogoAsset | null;
}

interface LayoutState {
  cursorY: number;
}

interface KpiMetricItem {
  label: string;
  value: string;
  sublabel?: string;
}

interface MetadataPair {
  label: string;
  value: string;
}

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_X = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 182mm
const HEADER_BOTTOM_Y = 33.5;
const CONTENT_START_Y = 39;
const FOOTER_TOP_Y = 283;
const FOOTER_MARGIN_BOTTOM = 18;
const SAFE_BOTTOM_Y = PAGE_HEIGHT - FOOTER_MARGIN_BOTTOM - 2; // 277mm

const COLOR_INK: [number, number, number] = [15, 23, 42];
const COLOR_BODY: [number, number, number] = [30, 41, 59];
const COLOR_MUTED: [number, number, number] = [71, 85, 105];
const COLOR_LIGHT_MUTED: [number, number, number] = [100, 116, 139];
const COLOR_BORDER: [number, number, number] = [203, 213, 225];
const COLOR_SURFACE: [number, number, number] = [248, 250, 252];
const COLOR_HEAD_BG: [number, number, number] = [30, 41, 59];
const COLOR_EMERALD: [number, number, number] = [5, 150, 105];
const COLOR_STATUS_GREEN: [number, number, number] = [4, 120, 87];
const COLOR_STATUS_BLUE: [number, number, number] = [29, 78, 216];
const COLOR_STATUS_AMBER: [number, number, number] = [180, 83, 9];
const COLOR_STATUS_RED: [number, number, number] = [185, 28, 28];

let cachedBrandLogosPromise: Promise<LoadedBrandLogos> | null = null;

export function sanitizePdfText(value: unknown, fallback = "Not Available"): string {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value)
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, "\u00B7")
    .replace(/\u2026/g, "...")
    .replace(/\u2192/g, "->")
    .replace(/\u00A0/g, " ")
    .replace(/[^\t\n\r\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized || fallback;
}

function loadSingleLogoDataUrl(src: string, alias: string): Promise<BrandLogoAsset | null> {
  if (typeof window === "undefined" || typeof document === "undefined" || !src) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const naturalW = img.naturalWidth || img.width || 320;
        const naturalH = img.naturalHeight || img.height || 320;
        const maxDim = 320;
        const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
        const targetW = Math.max(1, Math.round(naturalW * scale));
        const targetH = Math.max(1, Math.round(naturalH * scale));

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve({
          dataUrl: canvas.toDataURL("image/jpeg", 0.92),
          widthPx: targetW,
          heightPx: targetH,
          alias,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function loadBrandLogos(): Promise<LoadedBrandLogos> {
  if (!cachedBrandLogosPromise) {
    cachedBrandLogosPromise = Promise.all([
      loadSingleLogoDataUrl(nagaOfficialSealUrl, "naga-official-seal"),
      loadSingleLogoDataUrl(swmoLogoUrl, "swmo-official-logo"),
    ]).then(([nagaSeal, swmoLogo]) => ({
      nagaSeal,
      swmoLogo,
    }));
  }
  return cachedBrandLogosPromise;
}

function drawLogoBox(doc: jsPDF, logo: BrandLogoAsset | null, x: number, y: number, maxSizeMm: number, alignRight = false) {
  if (!logo?.dataUrl) return;
  const ratio = logo.widthPx > 0 && logo.heightPx > 0 ? logo.widthPx / logo.heightPx : 1;
  let drawW = maxSizeMm;
  let drawH = maxSizeMm;
  if (ratio >= 1) {
    drawW = maxSizeMm;
    drawH = maxSizeMm / ratio;
  } else {
    drawH = maxSizeMm;
    drawW = maxSizeMm * ratio;
  }
  const drawX = alignRight ? x - drawW : x;
  const drawY = y + (maxSizeMm - drawH) / 2;
  try {
    doc.addImage(logo.dataUrl, "JPEG", drawX, drawY, drawW, drawH, logo.alias, "MEDIUM");
  } catch {
    // Gracefully skip image placement if a malformed logo data URL is supplied.
  }
}

function drawOfficialPageChrome(
  doc: jsPDF,
  logos: LoadedBrandLogos,
  officeCityLabel: string,
  generatedAtLabel: string,
  pageNumber: number,
  totalPages: number,
) {
  // Top Official SWMO Masthead (matches Naga City Garbage Collection Schedule layout)
  drawLogoBox(doc, logos.nagaSeal, MARGIN_X, 8, 20.5, false);
  drawLogoBox(doc, logos.swmoLogo, PAGE_WIDTH - MARGIN_X, 8, 20.5, true);

  const centerX = PAGE_WIDTH / 2;
  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...COLOR_INK);
  doc.text("Republic of the Philippines", centerX, 13.5, { align: "center" });

  doc.setFont("times", "bold");
  doc.setFontSize(13.5);
  doc.setTextColor(...COLOR_INK);
  doc.text("Solid Waste Management Office", centerX, 19.2, { align: "center" });

  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...COLOR_BODY);
  doc.text(sanitizePdfText(officeCityLabel, "City of Naga, 4400"), centerX, 24.5, { align: "center" });

  // Clean divider beneath masthead
  doc.setDrawColor(...COLOR_INK);
  doc.setLineWidth(0.45);
  doc.line(MARGIN_X, 31.8, PAGE_WIDTH - MARGIN_X, 31.8);
  doc.setDrawColor(...COLOR_EMERALD);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, HEADER_BOTTOM_Y, PAGE_WIDTH - MARGIN_X, HEADER_BOTTOM_Y);

  // Running Footer
  doc.setDrawColor(...COLOR_BORDER);
  doc.setLineWidth(0.25);
  doc.line(MARGIN_X, FOOTER_TOP_Y, PAGE_WIDTH - MARGIN_X, FOOTER_TOP_Y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLOR_LIGHT_MUTED);
  doc.text("EcoLoop \u00B7 Naga City Solid Waste Management Office (SWMO)", MARGIN_X, 288);

  doc.text(`Generated: ${sanitizePdfText(generatedAtLabel)}`, PAGE_WIDTH / 2 + 12, 288, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLOR_MUTED);
  doc.text(`Page ${pageNumber} of ${totalPages}`, PAGE_WIDTH - MARGIN_X, 288, { align: "right" });
}

function ensureSpace(doc: jsPDF, state: LayoutState, requiredHeightMm: number) {
  if (state.cursorY + requiredHeightMm > SAFE_BOTTOM_Y) {
    doc.addPage();
    state.cursorY = CONTENT_START_Y;
  }
}

function drawDocumentTitleBlock(
  doc: jsPDF,
  state: LayoutState,
  title: string,
  subtitle: string,
) {
  doc.setFont("times", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...COLOR_INK);
  const titleLines = doc.splitTextToSize(sanitizePdfText(title.toUpperCase()), CONTENT_WIDTH) as string[];
  titleLines.forEach((line) => {
    doc.text(line, PAGE_WIDTH / 2, state.cursorY, { align: "center" });
    state.cursorY += 5.2;
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...COLOR_MUTED);
  const subLines = doc.splitTextToSize(sanitizePdfText(subtitle), CONTENT_WIDTH) as string[];
  subLines.forEach((line) => {
    doc.text(line, PAGE_WIDTH / 2, state.cursorY, { align: "center" });
    state.cursorY += 3.8;
  });

  state.cursorY += 2.2;
}

function drawMetadataGrid(doc: jsPDF, state: LayoutState, pairs: MetadataPair[]) {
  const cols = 2;
  const rowCount = Math.ceil(pairs.length / cols);
  const colWidth = CONTENT_WIDTH / cols;
  const lineH = 3.7;

  const preparedRows = Array.from({ length: rowCount }, (_, rIdx) => {
    const rowCells = [];
    let maxLines = 1;
    for (let cIdx = 0; cIdx < cols; cIdx += 1) {
      const pair = pairs[rIdx * cols + cIdx];
      if (!pair) {
        rowCells.push({ label: "", lines: [] as string[] });
        continue;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      const valLines = doc.splitTextToSize(sanitizePdfText(pair.value), colWidth - 8) as string[];
      maxLines = Math.max(maxLines, valLines.length);
      rowCells.push({ label: sanitizePdfText(pair.label).toUpperCase(), lines: valLines });
    }
    const rowHeight = Math.max(11.5, 6.2 + maxLines * lineH);
    return { rowCells, rowHeight };
  });

  const totalHeight = preparedRows.reduce((sum, r) => sum + r.rowHeight, 0);
  ensureSpace(doc, state, totalHeight + 4);

  const boxTop = state.cursorY;
  doc.setFillColor(...COLOR_SURFACE);
  doc.setDrawColor(...COLOR_BORDER);
  doc.setLineWidth(0.25);
  doc.rect(MARGIN_X, boxTop, CONTENT_WIDTH, totalHeight, "FD");

  // Center vertical divider
  doc.line(MARGIN_X + colWidth, boxTop, MARGIN_X + colWidth, boxTop + totalHeight);

  let currentY = boxTop;
  preparedRows.forEach((row, rIdx) => {
    if (rIdx > 0) {
      doc.setDrawColor(...COLOR_BORDER);
      doc.line(MARGIN_X, currentY, PAGE_WIDTH - MARGIN_X, currentY);
    }

    row.rowCells.forEach((cell, cIdx) => {
      if (!cell.label) return;
      const cellX = MARGIN_X + cIdx * colWidth + 3.5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      doc.setTextColor(...COLOR_MUTED);
      doc.text(cell.label, cellX, currentY + 4.1);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.2);
      doc.setTextColor(...COLOR_INK);
      cell.lines.forEach((line, lIdx) => {
        doc.text(line, cellX, currentY + 8.1 + lIdx * lineH);
      });
    });

    currentY += row.rowHeight;
  });

  state.cursorY = boxTop + totalHeight + 4.5;
}

function drawKpiStrip(doc: jsPDF, state: LayoutState, metrics: KpiMetricItem[]) {
  if (metrics.length === 0) return;
  const gap = 3;
  const boxWidth = (CONTENT_WIDTH - gap * (metrics.length - 1)) / metrics.length;
  const innerWidth = boxWidth - 5.6;
  const boxHeight = 16.5;
  ensureSpace(doc, state, boxHeight + 5);

  const topY = state.cursorY;
  metrics.forEach((item, index) => {
    const boxX = MARGIN_X + index * (boxWidth + gap);
    doc.setFillColor(...COLOR_SURFACE);
    doc.setDrawColor(...COLOR_BORDER);
    doc.setLineWidth(0.25);
    doc.rect(boxX, topY, boxWidth, boxHeight, "FD");

    // Top accent rule
    doc.setFillColor(...COLOR_EMERALD);
    doc.rect(boxX, topY, boxWidth, 1.1, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.6);
    doc.setTextColor(...COLOR_MUTED);
    const labelText = sanitizePdfText(item.label).toUpperCase();
    const labelLine = (doc.splitTextToSize(labelText, innerWidth) as string[])[0] ?? labelText;
    doc.text(labelLine, boxX + 2.8, topY + 4.8);

    const valText = sanitizePdfText(item.value);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLOR_INK);
    let valFontSize = 11.5;
    doc.setFontSize(valFontSize);
    if (doc.getTextWidth(valText) > innerWidth) {
      valFontSize = 9.2;
      doc.setFontSize(valFontSize);
    }
    if (doc.getTextWidth(valText) > innerWidth) {
      valFontSize = 7.8;
      doc.setFontSize(valFontSize);
    }
    const wrappedVal = doc.splitTextToSize(valText, innerWidth) as string[];
    const hasTwoLines = wrappedVal.length > 1;
    if (!hasTwoLines) {
      doc.text(wrappedVal[0] ?? valText, boxX + 2.8, topY + 10.8);
    } else {
      const line1 = wrappedVal[0] ?? "";
      const line2 = wrappedVal.length > 2 ? `${wrappedVal[1].slice(0, Math.max(0, wrappedVal[1].length - 3))}...` : wrappedVal[1];
      doc.text(line1, boxX + 2.8, topY + 8.6);
      doc.text(line2, boxX + 2.8, topY + 11.9);
    }

    if (item.sublabel) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.4);
      doc.setTextColor(...COLOR_LIGHT_MUTED);
      const truncated = (doc.splitTextToSize(sanitizePdfText(item.sublabel), innerWidth) as string[])[0] ?? "";
      doc.text(truncated, boxX + 2.8, topY + 14.9);
    }
  });

  state.cursorY = topY + boxHeight + 5;
}

function renderSectionHeading(doc: jsPDF, state: LayoutState, title: string, subtitle?: string) {
  // Reserve enough height for heading, optional subtitle, table header, and at least one body row
  const needed = subtitle ? 39 : 34;
  ensureSpace(doc, state, needed);

  // Subtle green vertical indicator bar
  doc.setFillColor(...COLOR_EMERALD);
  doc.rect(MARGIN_X, state.cursorY - 3.6, 1.6, 4.4, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_INK);
  doc.text(sanitizePdfText(title), MARGIN_X + 3.4, state.cursorY);
  state.cursorY += 4.2;

  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(...COLOR_MUTED);
    const subLines = doc.splitTextToSize(sanitizePdfText(subtitle), CONTENT_WIDTH) as string[];
    subLines.forEach((line) => {
      doc.text(line, MARGIN_X, state.cursorY);
      state.cursorY += 3.5;
    });
  }

  state.cursorY += 1.2;
}

function getStatusTextColor(rawText: string): [number, number, number] | null {
  const normalized = rawText.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized === "completed" ||
    normalized === "online" ||
    normalized === "resolved" ||
    normalized === "available"
  ) {
    return COLOR_STATUS_GREEN;
  }
  if (normalized === "active" || normalized === "on route" || normalized === "in progress") {
    return COLOR_STATUS_BLUE;
  }
  if (
    normalized.includes("returning") ||
    normalized.includes("delayed") ||
    normalized === "pending" ||
    normalized === "planned"
  ) {
    return COLOR_STATUS_AMBER;
  }
  if (normalized === "missed" || normalized === "offline" || normalized === "cancelled" || normalized === "suspended") {
    return COLOR_STATUS_RED;
  }
  return null;
}

function renderStyledTable(
  doc: jsPDF,
  state: LayoutState,
  config: {
    head: string[][];
    body: RowInput[];
    columnStyles: Record<number, { cellWidth: number; halign?: "left" | "center" | "right" }>;
    emptyMessage: string;
    statusColumns?: number[];
  },
) {
  const hasRows = config.body.length > 0;
  const colCount = config.head[0]?.length ?? 1;
  const sanitizeRow = (row: RowInput): RowInput => {
    if (!Array.isArray(row)) return row;
    return row.map((cell) => {
      if (typeof cell === "string" || typeof cell === "number" || cell == null) {
        return sanitizePdfText(cell);
      }
      if (typeof cell === "object" && "content" in cell) {
        return { ...cell, content: sanitizePdfText(cell.content) };
      }
      return cell;
    });
  };
  const tableBody: RowInput[] = hasRows
    ? config.body.map(sanitizeRow)
    : [
        [
          {
            content: sanitizePdfText(config.emptyMessage),
            colSpan: colCount,
            styles: {
              halign: "center",
              textColor: COLOR_LIGHT_MUTED,
              fontStyle: "italic",
              cellPadding: { top: 4.5, right: 3, bottom: 4.5, left: 3 },
            },
          },
        ],
      ];

  const statusCols = new Set(config.statusColumns ?? []);

  autoTable(doc, {
    startY: state.cursorY,
    head: config.head,
    body: tableBody,
    theme: "grid",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    margin: {
      top: CONTENT_START_Y,
      bottom: FOOTER_MARGIN_BOTTOM,
      left: MARGIN_X,
      right: MARGIN_X,
    },
    styles: {
      font: "helvetica",
      fontSize: 7.7,
      textColor: COLOR_BODY,
      lineColor: COLOR_BORDER,
      lineWidth: 0.2,
      cellPadding: { top: 2.1, right: 2, bottom: 2.1, left: 2 },
      valign: "top",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: COLOR_HEAD_BG,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7.8,
      cellPadding: { top: 2.4, right: 2, bottom: 2.4, left: 2 },
      valign: "middle",
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: config.columnStyles,
    didParseCell: (hookData) => {
      if (hookData.section === "body" && hasRows && statusCols.has(hookData.column.index)) {
        const firstLine = String(hookData.cell.raw ?? "").split("\n")[0] ?? "";
        const tint = getStatusTextColor(firstLine);
        if (tint) {
          hookData.cell.styles.textColor = tint;
          hookData.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
  state.cursorY = (typeof finalY === "number" ? finalY : state.cursorY + 12) + 6;
}

function drawPreparedBySignOff(
  doc: jsPDF,
  state: LayoutState,
  preparedBy: string,
  roleLabel: string,
  generatedAtLabel: string,
) {
  const blockHeight = 28;
  ensureSpace(doc, state, blockHeight);

  const topY = Math.max(state.cursorY + 2, state.cursorY);
  doc.setDrawColor(...COLOR_BORDER);
  doc.setLineWidth(0.25);
  doc.line(MARGIN_X, topY, PAGE_WIDTH - MARGIN_X, topY);

  // Left: Prepared by
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  doc.text("Prepared by:", MARGIN_X, topY + 6);

  doc.setFont("times", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_INK);
  doc.text(sanitizePdfText(preparedBy), MARGIN_X, topY + 14.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(`${sanitizePdfText(roleLabel)} \u00B7 Solid Waste Management Office`, MARGIN_X, topY + 18.8);
  doc.text(`Certified / Exported: ${sanitizePdfText(generatedAtLabel)}`, MARGIN_X, topY + 22.8);

  // Right: Noted / Reviewed by
  const rightX = MARGIN_X + 106;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  doc.text("Noted / Reviewed by:", rightX, topY + 6);

  doc.setDrawColor(...COLOR_INK);
  doc.setLineWidth(0.25);
  doc.line(rightX, topY + 14.8, PAGE_WIDTH - MARGIN_X, topY + 14.8);

  doc.setFontSize(7.6);
  doc.setTextColor(...COLOR_MUTED);
  doc.text("SWMO Operations Supervisor / Division Head", rightX, topY + 18.8);
  doc.text("Date Signed: ___________________________", rightX, topY + 22.8);

  state.cursorY = topY + blockHeight;
}

function buildReferenceStamp(prefix: string, date: Date): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/[^0-9]/g, "");
  return `${prefix}-${ymd.slice(0, 8)}-${ymd.slice(8, 12)}`;
}

function formatAreaFilterDisplay(data: SupervisorExportData, areaCode?: string): string {
  const trimmed = areaCode?.trim();
  if (!trimmed || trimmed === "ALL") return "All Collection Areas";
  const match = data.collectionSchedules.find((s) => s.area_code?.trim() === trimmed);
  return match?.area_name?.trim() ? `${trimmed} - ${match.area_name.trim()}` : trimmed;
}

function formatDayFilterDisplay(scheduleDay?: string): string {
  const day = normalizeScheduleDayFilter(scheduleDay);
  if (day === "ALL") return "All Scheduled Days";
  const map: Record<string, string> = {
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday",
    Sat: "Saturday",
    Sun: "Sunday",
  };
  return map[day] ?? day;
}

function formatRouteStatusFilterDisplay(routeStatus?: string): string {
  const s = normalizeStatus(routeStatus);
  if (!s || s === "all") return "All Route Statuses";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderRouteReportTables(
  doc: jsPDF,
  state: LayoutState,
  routes: EnrichedRouteReportRow[],
  headingLabel = "Route Dispatch & Operational Summary",
  stopsHeadingLabel = "Collection Stop Sequence & Progress",
  includeStopsSection = true,
) {
  renderSectionHeading(
    doc,
    state,
    headingLabel,
    `Total matched routes: ${routes.length} (sorted by latest dispatch / assignment time in PHT)`,
  );

  const routeRows: RowInput[] = routes.map((route) => {
    const timestamps = [
      `Created: ${formatPhilippineDateTime(route.createdAt)}`,
      `Done: ${route.completedAt ? formatPhilippineDateTime(route.completedAt) : "Not Available"}`,
    ].join("\n");
    const statusAndProgress = [
      route.statusLabel,
      `${route.completedStops}/${route.totalStops} stops (${route.progressPercent}%)`,
      `Dest: ${route.landfillDestination}`,
    ].join("\n");

    return [
      sanitizePdfText(`${route.reference}\n${route.name}`),
      sanitizePdfText(route.areaLabel),
      sanitizePdfText(`${route.scheduledDaysLabel}\n${route.shiftLabel}`),
      sanitizePdfText(`${route.vehicleLabel}\nType: ${route.vehicleType}`),
      sanitizePdfText(route.driverName),
      sanitizePdfText(timestamps),
      sanitizePdfText(statusAndProgress),
    ];
  });

  renderStyledTable(doc, state, {
    head: [
      [
        "Route Ref / Name",
        "Collection Area",
        "Schedule / Shift",
        "Assigned Truck",
        "Driver",
        "Timestamps (PHT)",
        "Status / Progress",
      ],
    ],
    body: routeRows,
    statusColumns: [6],
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 23 },
      2: { cellWidth: 22 },
      3: { cellWidth: 27 },
      4: { cellWidth: 24 },
      5: { cellWidth: 27 },
      6: { cellWidth: 27 },
    },
    emptyMessage: "No routes matched the selected filters and date range.",
  });

  if (!includeStopsSection) return;

  const stopRows: RowInput[] = [];
  routes.forEach((route) => {
    if (route.stops.length === 0) {
      stopRows.push([
        sanitizePdfText(`${route.reference}\n${route.areaLabel}`),
        "-",
        "Not Available",
        sanitizePdfText(`${route.name} (No stop sequence recorded)`),
        sanitizePdfText(route.shiftLabel),
        sanitizePdfText(route.statusLabel),
        sanitizePdfText(formatPhilippineDateTime(route.completedAt)),
      ]);
      return;
    }

    route.stops.forEach((stop) => {
      stopRows.push([
        sanitizePdfText(`${route.reference} - ${route.name}\n${route.areaLabel}`),
        `#${stop.stopOrder}`,
        sanitizePdfText(stop.binCode),
        sanitizePdfText(`${stop.location}\nBrgy: ${stop.barangay}`),
        sanitizePdfText(stop.scheduleWindow),
        sanitizePdfText(stop.activityState),
        sanitizePdfText(formatPhilippineDateTime(stop.completedAt)),
      ]);
    });
  });

  renderSectionHeading(
    doc,
    state,
    stopsHeadingLabel,
    "Ordered collection stops, street/barangay locations, schedule windows, and completion times.",
  );

  renderStyledTable(doc, state, {
    head: [["Route / Area", "Seq", "Bin Code", "Street / Location & Barangay", "Window", "Stop Status", "Completed (PHT)"]],
    body: stopRows,
    statusColumns: [5],
    columnStyles: {
      0: { cellWidth: 33 },
      1: { cellWidth: 10, halign: "center" },
      2: { cellWidth: 19 },
      3: { cellWidth: 52 },
      4: { cellWidth: 22 },
      5: { cellWidth: 19 },
      6: { cellWidth: 27 },
    },
    emptyMessage: "No collection stops available for the matched routes.",
  });
}

function buildDriverReportSections(
  doc: jsPDF,
  state: LayoutState,
  data: SupervisorExportData,
  options: ExportSupervisorPdfOptions,
  range: DateRange,
  generatedAtLabel: string,
  landfillLabel: string,
  areaDisplay: string,
  dayDisplay: string,
  statusDisplay: string,
) {
  const isAllDrivers = !options.driverId || options.driverId === "ALL";
  const activeDrivers = data.drivers.filter((d) => {
    const s = normalizeStatus(d.status);
    return s !== "inactive" && s !== "suspended";
  });
  const selectedDriver: SupervisorExportDriver | null = !isAllDrivers
    ? data.drivers.find((d) => String(d.id) === String(options.driverId)) ?? null
    : null;

  if (!isAllDrivers && !selectedDriver) {
    throw new Error("The selected driver profile is unavailable in the database.");
  }

  const scopedDrivers = isAllDrivers ? activeDrivers : [selectedDriver!];
  const scopedDriverIds = new Set(scopedDrivers.map((d) => String(d.id)));

  const matchedRoutes = buildEnrichedRouteReports(data, {
    range,
    scheduleDay: options.scheduleDay,
    routeStatus: options.routeStatus,
    areaCode: options.areaCode,
    driverId: isAllDrivers ? "ALL" : selectedDriver!.id,
  }).filter((route) => {
    if (!isAllDrivers) return true;
    const rawRoute = data.routes.find((r) => r.id === route.id);
    if (!rawRoute || rawRoute.driver_id == null) return false;
    return scopedDriverIds.has(String(rawRoute.driver_id));
  });

  const matchedRouteIdSet = new Set(matchedRoutes.map((r) => String(r.id)));
  const rawFilteredRoutes = data.routes.filter((r) => matchedRouteIdSet.has(String(r.id)));
  const deliveriesInRange = filterDeliveriesForRange(data.deliveries, range).filter((d) =>
    d.driver_id != null ? scopedDriverIds.has(String(d.driver_id)) : matchedRouteIdSet.has(String(d.route_id)),
  );
  const reportsInRange = filterReportsForRange(data.reports, range).filter((r) => {
    if (!isAllDrivers) return String(r.driver_id ?? "") === String(selectedDriver!.id);
    return r.driver_id != null && scopedDriverIds.has(String(r.driver_id));
  });

  const performanceRows = buildDriverPerformanceRows(
    scopedDrivers,
    rawFilteredRoutes,
    deliveriesInRange,
    reportsInRange,
    data.vehicles,
  );
  const fleetRowsAll = buildFleetMonitoringRows(data, {});
  const fleetByDriverName = new Map<string, FleetMonitoringExportRow>();
  fleetRowsAll.forEach((row) => {
    if (row.driverName && row.driverName !== "Unassigned") {
      fleetByDriverName.set(row.driverName.toLowerCase(), row);
    }
  });

  const driverVehicleById = new Map<string, SupervisorExportVehicle>();
  data.vehicles.forEach((v) => {
    if (v.driver_id != null) driverVehicleById.set(String(v.driver_id), v);
  });

  const totalStopsCompleted = matchedRoutes.reduce((sum, r) => sum + r.completedStops, 0);
  const totalStopsPlanned = matchedRoutes.reduce((sum, r) => sum + r.totalStops, 0);
  const completedRoutesCount = matchedRoutes.filter((r) => normalizeStatus(r.statusRaw) === "completed").length;

  drawDocumentTitleBlock(
    doc,
    state,
    isAllDrivers ? "ALL ACTIVE DRIVERS OPERATIONAL REPORT" : "DRIVER OPERATIONAL REPORT",
    `${range.label} Report (${formatRangeLabel(range)})`,
  );

  const singleDriverVehicle: SupervisorExportVehicle | null = selectedDriver
    ? (selectedDriver.assigned_vehicle_id != null
        ? data.vehicles.find((v) => String(v.id) === String(selectedDriver.assigned_vehicle_id)) ?? null
        : driverVehicleById.get(String(selectedDriver.id)) ?? null)
    : null;
  const singleFleet = selectedDriver ? fleetByDriverName.get(selectedDriver.name.trim().toLowerCase()) ?? null : null;

  drawMetadataGrid(doc, state, [
    { label: "Document Reference", value: buildReferenceStamp("SWMO-DRV", new Date()) },
    { label: "Prepared / Exported By", value: options.supervisorName },
    {
      label: isAllDrivers ? "Driver Scope" : "Driver Profile",
      value: isAllDrivers
        ? `All Active Drivers (${scopedDrivers.length})`
        : `${selectedDriver!.name} (${labelDriverStatus(selectedDriver!.status)})`,
    },
    { label: "Covered Period (PHT)", value: `${range.label} (${formatRangeLabel(range)})` },
    {
      label: isAllDrivers ? "Applied Filters" : "Assigned Truck & Type",
      value: isAllDrivers
        ? `${areaDisplay} | ${dayDisplay} | ${statusDisplay}`
        : singleDriverVehicle
          ? `${formatVehicleTitle(singleDriverVehicle)} (${formatVehicleType(singleDriverVehicle)})`
          : "Not Available",
    },
    { label: "Landfill Destination", value: landfillLabel },
    {
      label: isAllDrivers ? "Fleet Connectivity" : "Driver Connectivity / GPS",
      value: isAllDrivers
        ? `${fleetRowsAll.filter((f) => f.onlineStatus === "Online").length} online trucks monitored`
        : singleFleet
          ? `${singleFleet.onlineStatus} (${singleFleet.operationalStatusLabel}) | Last GPS: ${formatPhilippineDateTime(singleFleet.lastGpsAt)}`
          : `Last Seen: ${formatPhilippineDateTime(selectedDriver?.last_seen_at)}`,
    },
    { label: "Generated At", value: generatedAtLabel },
  ]);

  drawKpiStrip(doc, state, [
    {
      label: isAllDrivers ? "Active Drivers" : "Assigned Routes",
      value: isAllDrivers ? String(scopedDrivers.length) : String(matchedRoutes.length),
      sublabel: isAllDrivers ? `${matchedRoutes.length} routes in period` : `${completedRoutesCount} completed`,
    },
    {
      label: "Routes Completed",
      value: `${completedRoutesCount}/${matchedRoutes.length}`,
      sublabel:
        matchedRoutes.length > 0
          ? `${Math.round((completedRoutesCount / matchedRoutes.length) * 100)}% completion`
          : "No routes matched",
    },
    {
      label: "Stops Collected",
      value: `${totalStopsCompleted}/${totalStopsPlanned}`,
      sublabel: `${deliveriesInRange.filter((d) => d.status === "completed").length} recorded deliveries`,
    },
    {
      label: "Field Reports / Issues",
      value: String(reportsInRange.length),
      sublabel: `${reportsInRange.filter((r) => normalizeStatus(r.status) !== "resolved").length} open / active`,
    },
  ]);

  renderSectionHeading(
    doc,
    state,
    "Driver Operational Performance & Vehicle Assignment",
    isAllDrivers
      ? "Summary of active drivers, assigned vehicles, route completion, stop deliveries, and field issues."
      : "Driver profile status, assigned garbage truck, GPS activity, and period performance.",
  );

  renderStyledTable(doc, state, {
    head: [
      [
        "Driver Name",
        "Driver Status",
        "Assigned Truck & Type",
        "Connectivity / Last GPS",
        "Routes (Done/Total)",
        "Completion",
        "Issues",
      ],
    ],
    body: performanceRows.map((row) => {
      const driver = scopedDrivers.find((d) => String(d.id) === row.id);
      const vehicle =
        driver?.assigned_vehicle_id != null
          ? data.vehicles.find((v) => String(v.id) === String(driver.assigned_vehicle_id)) ?? null
          : driverVehicleById.get(row.id) ?? null;
      const fleet = fleetByDriverName.get(row.name.trim().toLowerCase());
      const truckText = vehicle
        ? `${formatVehicleTitle(vehicle)}\nType: ${formatVehicleType(vehicle)}`
        : `${row.vehicleLabel}\nType: Not Available`;
      const gpsText = fleet
        ? `${fleet.onlineStatus}\n${formatPhilippineDateTime(fleet.lastGpsAt)}`
        : `Offline\n${formatPhilippineDateTime(driver?.last_seen_at)}`;

      return [
        sanitizePdfText(row.name),
        sanitizePdfText(labelDriverStatus(row.status)),
        sanitizePdfText(truckText),
        sanitizePdfText(gpsText),
        `${row.completed} / ${row.assigned}\n(${row.collectionsCompleted} deliveries)`,
        `${row.completionPct}%`,
        String(row.reportsFiled),
      ];
    }),
    statusColumns: [1],
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 21 },
      2: { cellWidth: 35 },
      3: { cellWidth: 33 },
      4: { cellWidth: 28 },
      5: { cellWidth: 21, halign: "center" },
      6: { cellWidth: 16, halign: "center" },
    },
    emptyMessage: "No driver operational records matched the selected filters.",
  });

  renderRouteReportTables(
    doc,
    state,
    matchedRoutes,
    "Assigned Collection Routes & Dispatch Log",
    "Route Stop Sequence & Collection Locations",
    true,
  );

  renderSectionHeading(
    doc,
    state,
    "Driver Incident & Field Reports",
    "Operational incidents, overflow notices, missed collections, or remarks filed in this period.",
  );

  renderStyledTable(doc, state, {
    head: [["Report Ref", "Category", "Location", "Status", "Reported At (PHT)", "Remarks / Description"]],
    body: reportsInRange.map((report) => [
      sanitizePdfText(report.report_number?.trim() || `RPT-${String(report.id).slice(0, 8).toUpperCase()}`),
      sanitizePdfText(formatReportType(report)),
      sanitizePdfText(report.location),
      sanitizePdfText(labelReportStatus(report.status)),
      sanitizePdfText(formatPhilippineDateTime(report.created_at)),
      sanitizePdfText(report.description),
    ]),
    statusColumns: [3],
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 25 },
      2: { cellWidth: 31 },
      3: { cellWidth: 20 },
      4: { cellWidth: 28 },
      5: { cellWidth: 46 },
    },
    emptyMessage: "No field incident or operational reports were filed during this period.",
  });
}

function buildRouteReportSections(
  doc: jsPDF,
  state: LayoutState,
  data: SupervisorExportData,
  options: ExportSupervisorPdfOptions,
  range: DateRange,
  generatedAtLabel: string,
  landfillLabel: string,
  areaDisplay: string,
  dayDisplay: string,
  statusDisplay: string,
) {
  const routes = buildEnrichedRouteReports(data, {
    range,
    scheduleDay: options.scheduleDay,
    routeStatus: options.routeStatus,
    areaCode: options.areaCode,
    driverId: options.driverId,
  });

  const totalStops = routes.reduce((sum, r) => sum + r.totalStops, 0);
  const completedStops = routes.reduce((sum, r) => sum + r.completedStops, 0);
  const completedRoutes = routes.filter((r) => normalizeStatus(r.statusRaw) === "completed").length;
  const activeOrPendingRoutes = routes.filter((r) =>
    ["active", "in_progress", "pending", "planned"].includes(normalizeStatus(r.statusRaw)),
  ).length;
  const stopRate = totalStops > 0 ? Math.round((completedStops / totalStops) * 100) : 0;

  const selectedDriverName =
    options.driverId && options.driverId !== "ALL"
      ? data.drivers.find((d) => String(d.id) === String(options.driverId))?.name ?? `Driver #${options.driverId}`
      : "All Drivers";

  drawDocumentTitleBlock(
    doc,
    state,
    "GARBAGE COLLECTION ROUTE OPERATIONS REPORT",
    `${range.label} Dispatch & Stop Sequence Report (${formatRangeLabel(range)})`,
  );

  drawMetadataGrid(doc, state, [
    { label: "Document Reference", value: buildReferenceStamp("SWMO-RTE", new Date()) },
    { label: "Prepared / Exported By", value: options.supervisorName },
    { label: "Collection Area Filter", value: areaDisplay },
    { label: "Covered Period (PHT)", value: `${range.label} (${formatRangeLabel(range)})` },
    { label: "Collection Day & Status", value: `${dayDisplay} | ${statusDisplay}` },
    { label: "Driver Filter", value: selectedDriverName },
    { label: "Landfill / Disposal Site", value: landfillLabel },
    { label: "Generated At", value: generatedAtLabel },
  ]);

  drawKpiStrip(doc, state, [
    {
      label: "Matched Routes",
      value: String(routes.length),
      sublabel: `${completedRoutes} completed / ${activeOrPendingRoutes} active-pending`,
    },
    {
      label: "Total Route Stops",
      value: String(totalStops),
      sublabel: `${completedStops} stops collected (${stopRate}%)`,
    },
    {
      label: "Total Route Distance",
      value: `${routes.reduce((sum, r) => sum + r.distanceKm, 0).toFixed(1)} km`,
      sublabel: "Dispatched distance",
    },
    {
      label: "Landfill Destination",
      value: data.landfill.name || "SWMO Landfill",
      sublabel: data.landfill.address || "Naga City",
    },
  ]);

  renderRouteReportTables(
    doc,
    state,
    routes,
    "Collection Route Summary & Assignments",
    "Route Collection Stops & Sequence Progress",
    true,
  );
}

function buildFleetReportSections(
  doc: jsPDF,
  state: LayoutState,
  data: SupervisorExportData,
  options: ExportSupervisorPdfOptions,
  generatedAtLabel: string,
  landfillLabel: string,
  areaDisplay: string,
) {
  const fleetRows = buildFleetMonitoringRows(data, {
    fleetStatus: options.fleetStatus,
    areaCode: options.areaCode,
  });

  const onlineCount = fleetRows.filter((r) => r.onlineStatus === "Online").length;
  const offlineCount = fleetRows.filter((r) => r.onlineStatus === "Offline").length;
  const onRouteOrLandfill = fleetRows.filter(
    (r) => r.operationalStatusKey === "on_route" || r.operationalStatusKey === "returning_to_landfill",
  ).length;
  const stoppedCount = fleetRows.filter((r) => r.operationalStatusKey === "stopped").length;

  const fleetFilterLabel =
    !options.fleetStatus || options.fleetStatus === "ALL"
      ? "All Fleet & Connectivity Statuses"
      : options.fleetStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  drawDocumentTitleBlock(
    doc,
    state,
    "FLEET & LIVE MONITORING STATUS REPORT",
    `Official Fleet Readiness & GPS Snapshot (${generatedAtLabel})`,
  );

  drawMetadataGrid(doc, state, [
    { label: "Document Reference", value: buildReferenceStamp("SWMO-FLT", new Date()) },
    { label: "Prepared / Exported By", value: options.supervisorName },
    { label: "Fleet Status Filter", value: fleetFilterLabel },
    { label: "Monitoring Snapshot", value: generatedAtLabel },
    { label: "Collection Area Filter", value: areaDisplay },
    { label: "Landfill Geofence Site", value: landfillLabel },
  ]);

  drawKpiStrip(doc, state, [
    { label: "Monitored Trucks", value: String(fleetRows.length), sublabel: "Active fleet roster" },
    { label: "Online Units", value: String(onlineCount), sublabel: `${offlineCount} offline units` },
    { label: "On Route / Landfill", value: String(onRouteOrLandfill), sublabel: "Actively deployed" },
    { label: "Stopped / Delayed GPS", value: String(stoppedCount), sublabel: "Requires dispatcher check" },
  ]);

  renderSectionHeading(
    doc,
    state,
    "Fleet Identification, Driver Assignment & GPS Status",
    "Real-time operational state, online connectivity, last GPS update (PHT), active route, and assigned collection area.",
  );

  renderStyledTable(doc, state, {
    head: [
      [
        "Truck ID / Plate",
        "Vehicle Type",
        "Assigned Driver",
        "Operational Status",
        "Online",
        "Current Route & Area",
        "Last GPS Update & Coords",
      ],
    ],
    body: fleetRows.map((row) => [
      sanitizePdfText(`${row.truckCode}\nPlate: ${row.plateNumber}\n${row.vehicleLabel}`),
      sanitizePdfText(row.vehicleType),
      sanitizePdfText(row.driverName),
      sanitizePdfText(row.operationalStatusLabel),
      sanitizePdfText(row.onlineStatus),
      sanitizePdfText(`${row.currentRoute}\nArea: ${row.areaLabel}`),
      sanitizePdfText(`${formatPhilippineDateTime(row.lastGpsAt)}\n${row.coordinatesLabel}\nSpeed: ${row.speedLabel}`),
    ]),
    statusColumns: [3, 4],
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 23 },
      2: { cellWidth: 24 },
      3: { cellWidth: 25 },
      4: { cellWidth: 16, halign: "center" },
      5: { cellWidth: 33 },
      6: { cellWidth: 33 },
    },
    emptyMessage: "No fleet vehicles matched the selected status or area filters.",
  });

  renderSectionHeading(
    doc,
    state,
    "SWMO Telemetry & Geofence Thresholds",
    "Configured system rules applied to compute fleet status and landfill return indicators.",
  );

  renderStyledTable(doc, state, {
    head: [["Monitoring Rule", "Configured Threshold", "Operational Interpretation"]],
    body: [
      [
        "GPS Telemetry Delayed",
        `${data.operationsConfig.gpsDelayedSeconds} seconds`,
        "Unit flagged Stopped / Delayed GPS if active route GPS feed exceeds delay threshold or speed is 0 kph.",
      ],
      [
        "Driver / Unit Offline",
        `${data.operationsConfig.driverOfflineSeconds} seconds`,
        "Unit classified Offline when both GPS feed and driver heartbeat exceed offline window.",
      ],
      [
        "Landfill Arrival Geofence",
        `${data.operationsConfig.landfillProximityMeters} meters (${data.landfill.name})`,
        "Active route trucks inside this radius or with Full / Unloading state show Returning to Landfill.",
      ],
    ],
    columnStyles: {
      0: { cellWidth: 42 },
      1: { cellWidth: 46 },
      2: { cellWidth: 94 },
    },
    emptyMessage: "No threshold rules configured.",
  });
}

function renderActivitySummariesTable(
  doc: jsPDF,
  state: LayoutState,
  summaries: CollectionActivityScheduleSummary[],
) {
  renderSectionHeading(
    doc,
    state,
    "Collection Schedule Compliance Summary by Area",
    "Planned, active, completed, and missed collection activity grouped by SWMO collection area.",
  );

  renderStyledTable(doc, state, {
    head: [["Area / Code", "Schedule Days & Shift", "Waste Type", "Planned", "Active", "Done", "Missed", "Remarks / Notes"]],
    body: summaries.map((area) => [
      sanitizePdfText(`${area.areaName}\nCode: ${area.areaCode}`),
      sanitizePdfText(`${area.scheduleDaysLabel}\n${area.shiftWindow}`),
      sanitizePdfText(area.wasteCategory),
      String(area.plannedCount),
      String(area.activeCount),
      String(area.completedCount),
      String(area.missedCount),
      sanitizePdfText(area.remarks),
    ]),
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 31 },
      2: { cellWidth: 23 },
      3: { cellWidth: 15, halign: "right" },
      4: { cellWidth: 13, halign: "right" },
      5: { cellWidth: 13, halign: "right" },
      6: { cellWidth: 14, halign: "right" },
      7: { cellWidth: 38 },
    },
    emptyMessage: "No collection areas matched the selected schedule day or area filters.",
  });
}

function renderActivityDetailsTable(
  doc: jsPDF,
  state: LayoutState,
  details: CollectionActivityDetailRow[],
) {
  renderSectionHeading(
    doc,
    state,
    "Detailed Stop-Level Collection Activity",
    "Recorded collection activity per route stop, date/time (PHT), assigned driver, vehicle, and status.",
  );

  renderStyledTable(doc, state, {
    head: [["Area & Schedule", "Route / Seq", "Stop Location & Barangay", "State", "Collection Time (PHT)", "Driver / Truck & Remarks"]],
    body: details.map((item) => [
      sanitizePdfText(`${item.areaLabel}\n${item.scheduleLabel}`),
      sanitizePdfText(`${item.routeName}${item.stopOrder != null ? `\nStop #${item.stopOrder}` : ""}`),
      sanitizePdfText(`${item.location}\nBrgy: ${item.barangay}`),
      sanitizePdfText(item.activityState),
      sanitizePdfText(formatPhilippineDateTime(item.activityAt)),
      sanitizePdfText(`${item.driverAndVehicle}\n${item.remarks}`),
    ]),
    statusColumns: [3],
    columnStyles: {
      0: { cellWidth: 31 },
      1: { cellWidth: 27 },
      2: { cellWidth: 42 },
      3: { cellWidth: 18 },
      4: { cellWidth: 28 },
      5: { cellWidth: 36 },
    },
    emptyMessage: "No collection activity records matched the selected period and filters.",
  });
}

function renderMissedAndIssuesTable(
  doc: jsPDF,
  state: LayoutState,
  rows: MissedOrIssueExportRow[],
) {
  renderSectionHeading(
    doc,
    state,
    "Missed Collections & Field Incident Remarks",
    "Incomplete route stops and operational field reports flagged during the reporting window.",
  );

  renderStyledTable(doc, state, {
    head: [["Ref / Source", "Area & Location", "Driver / Truck", "Reported (PHT)", "Status / Priority", "Remarks & Details"]],
    body: rows.map((row) => [
      sanitizePdfText(`${row.reference}\n${row.sourceKind}`),
      sanitizePdfText(`${row.areaLabel}\n${row.location}`),
      sanitizePdfText(row.driverAndVehicle),
      sanitizePdfText(formatPhilippineDateTime(row.reportedAt)),
      sanitizePdfText(`${row.statusLabel}\nPriority: ${row.priorityLabel}`),
      sanitizePdfText(row.remarks),
    ]),
    statusColumns: [4],
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 38 },
      2: { cellWidth: 28 },
      3: { cellWidth: 27 },
      4: { cellWidth: 21 },
      5: { cellWidth: 36 },
    },
    emptyMessage: "No missed collections or field issues were recorded for the selected filters.",
  });
}

function buildActivityReportSections(
  doc: jsPDF,
  state: LayoutState,
  data: SupervisorExportData,
  options: ExportSupervisorPdfOptions,
  range: DateRange,
  generatedAtLabel: string,
  landfillLabel: string,
  areaDisplay: string,
  dayDisplay: string,
) {
  const { areaSummaries, activityDetails, missedAndIssues } = buildCollectionActivityReportData(data, {
    range,
    scheduleDay: options.scheduleDay,
    areaCode: options.areaCode,
  });

  const totalCompleted = areaSummaries.reduce((sum, a) => sum + a.completedCount, 0);
  const totalPlannedOrActive = areaSummaries.reduce((sum, a) => sum + a.plannedCount + a.activeCount, 0);
  const totalMissed = areaSummaries.reduce((sum, a) => sum + a.missedCount, 0);

  drawDocumentTitleBlock(
    doc,
    state,
    "COLLECTION ACTIVITY & SCHEDULE COMPLIANCE REPORT",
    `${range.label} SWMO Operational Activity (${formatRangeLabel(range)})`,
  );

  drawMetadataGrid(doc, state, [
    { label: "Document Reference", value: buildReferenceStamp("SWMO-ACT", new Date()) },
    { label: "Prepared / Exported By", value: options.supervisorName },
    { label: "Collection Area Filter", value: areaDisplay },
    { label: "Covered Period (PHT)", value: `${range.label} (${formatRangeLabel(range)})` },
    { label: "Scheduled Day Filter", value: dayDisplay },
    { label: "Landfill / Disposal Site", value: landfillLabel },
    { label: "Activity Log Entries", value: `${activityDetails.length} stop records across ${areaSummaries.length} areas` },
    { label: "Generated At", value: generatedAtLabel },
  ]);

  drawKpiStrip(doc, state, [
    { label: "Collection Areas", value: String(areaSummaries.length), sublabel: dayDisplay },
    { label: "Completed Collections", value: String(totalCompleted), sublabel: "Stops / bins collected" },
    { label: "Planned / Active", value: String(totalPlannedOrActive), sublabel: "Scheduled or in progress" },
    { label: "Missed / Issues", value: `${totalMissed} / ${missedAndIssues.length}`, sublabel: "Missed stops & reports" },
  ]);

  renderActivitySummariesTable(doc, state, areaSummaries);
  renderActivityDetailsTable(doc, state, activityDetails);
  renderMissedAndIssuesTable(doc, state, missedAndIssues);
}

export function buildDispatcherPdfDocument(
  data: SupervisorExportData,
  options: ExportSupervisorPdfOptions,
  logos: LoadedBrandLogos = { nagaSeal: null, swmoLogo: null },
): { doc: jsPDF; filename: string } {
  const reportType: DispatcherPdfReportType = options.reportType ?? "driver";
  const range = getDateRange(options.period, options.customStart, options.customEnd);
  const now = new Date();
  const generatedAtLabel = formatPhilippineDateTime(now);
  const landfillLabel = data.landfill.name
    ? `${data.landfill.name}${data.landfill.address ? ` (${data.landfill.address})` : ""}`
    : "SWMO Sanitary Landfill";
  const areaDisplay = formatAreaFilterDisplay(data, options.areaCode);
  const dayDisplay = formatDayFilterDisplay(options.scheduleDay);
  const statusDisplay = formatRouteStatusFilterDisplay(options.routeStatus);

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const state: LayoutState = { cursorY: CONTENT_START_Y };

  if (reportType === "route") {
    buildRouteReportSections(
      doc,
      state,
      data,
      options,
      range,
      generatedAtLabel,
      landfillLabel,
      areaDisplay,
      dayDisplay,
      statusDisplay,
    );
  } else if (reportType === "fleet") {
    buildFleetReportSections(doc, state, data, options, generatedAtLabel, landfillLabel, areaDisplay);
  } else if (reportType === "activity") {
    buildActivityReportSections(
      doc,
      state,
      data,
      options,
      range,
      generatedAtLabel,
      landfillLabel,
      areaDisplay,
      dayDisplay,
    );
  } else {
    buildDriverReportSections(
      doc,
      state,
      data,
      options,
      range,
      generatedAtLabel,
      landfillLabel,
      areaDisplay,
      dayDisplay,
      statusDisplay,
    );
  }

  drawPreparedBySignOff(
    doc,
    state,
    options.supervisorName,
    options.supervisorRoleLabel ?? "Dispatcher / Operations Personnel",
    generatedAtLabel,
  );

  // Apply repeating official SWMO header & footer on EVERY page after all tables settle
  const officeCityLabel =
    data.organizationCity && data.organizationCity.toLowerCase().includes("naga")
      ? data.organizationCity
      : "City of Naga, 4400";
  const totalPages = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    doc.setPage(pageNumber);
    drawOfficialPageChrome(doc, logos, officeCityLabel, generatedAtLabel, pageNumber, totalPages);
  }

  const dateStamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  let slug = "operational";
  if (reportType === "driver") {
    if (!options.driverId || options.driverId === "ALL") {
      slug = "all-drivers";
    } else {
      const driverName = data.drivers.find((d) => String(d.id) === String(options.driverId))?.name ?? "driver";
      slug = `driver-${driverName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report"}`;
    }
  } else if (reportType === "route") {
    slug = "route-operations";
  } else if (reportType === "fleet") {
    slug = "fleet-monitoring";
  } else if (reportType === "activity") {
    slug = "collection-activity";
  }

  const filename = `swmo-${slug}-report-${dateStamp}.pdf`;
  return { doc, filename };
}

export async function exportSupervisorPdf(options: ExportSupervisorPdfOptions) {
  const [data, logos] = await Promise.all([fetchSupervisorExportData(), loadBrandLogos()]);
  const { doc, filename } = buildDispatcherPdfDocument(data, options, logos);
  doc.save(filename);
}
