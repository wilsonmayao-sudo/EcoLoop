import React, { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { parseReportCoordinate } from "../../utils/reportMedia";

type ReportLocationMapProps = {
  latitude: unknown;
  longitude: unknown;
  className?: string;
};

/**
 * Embedded OpenStreetMap (interactive pan/zoom inside the iframe).
 * No extra npm deps; works on responsive layouts.
 */
export default function ReportLocationMap({ latitude, longitude, className = "" }: ReportLocationMapProps) {
  const lat = parseReportCoordinate(latitude);
  const lng = parseReportCoordinate(longitude);

  const embedSrc = useMemo(() => {
    if (lat == null || lng == null) return null;
    const delta = 0.012;
    const minLon = lng - delta;
    const minLat = lat - delta;
    const maxLon = lng + delta;
    const maxLat = lat + delta;
    const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lng}`;
  }, [lat, lng]);

  const openHref =
    lat != null && lng != null ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}` : null;

  if (embedSrc == null) {
    return (
      <div className={`rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 ${className}`}>
        No GPS coordinates on file for this report.
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="relative w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100 shadow-inner">
        <iframe title="Report location map" src={embedSrc} className="h-56 w-full min-h-[200px] border-0 md:h-72" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      </div>
      {openHref && (
        <a href={openHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800">
          <ExternalLink className="size-4 shrink-0" />
          Open full map
        </a>
      )}
    </div>
  );
}
