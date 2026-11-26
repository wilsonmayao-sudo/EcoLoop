export type ClassifiedMapboxError = {
  kind: "ignore" | "transient" | "auth" | "webgl";
  status?: number;
  message: string;
};

export const MISSING_MAPBOX_TOKEN_MESSAGE =
  "Mapbox access token (VITE_MAPBOX_ACCESS_TOKEN) is not configured.";

export function getWebMapboxToken(): string {
  try {
    // Keep literal `import.meta.env.VITE_MAPBOX_ACCESS_TOKEN` so Vite statically inlines it.
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    return typeof token === "string" ? token.trim() : "";
  } catch {
    return "";
  }
}

function extractErrorDetails(eventOrError: unknown): {
  status?: number;
  name: string;
  rawMessage: string;
} {
  const errObj =
    eventOrError && typeof eventOrError === "object" && "error" in eventOrError
      ? (eventOrError as { error?: any }).error
      : eventOrError;
  const status =
    typeof errObj?.status === "number"
      ? errObj.status
      : typeof (eventOrError as any)?.status === "number"
        ? (eventOrError as any).status
        : undefined;
  const name = typeof errObj?.name === "string" ? errObj.name : "";
  const rawMessage =
    typeof errObj?.message === "string"
      ? errObj.message
      : typeof eventOrError === "string"
        ? eventOrError
        : "";
  return { status, name, rawMessage: rawMessage.trim() };
}

/** Distinguish ignorable aborts and transient tile/network blips from fatal auth or WebGL failures. */
export function classifyMapboxError(eventOrError: unknown): ClassifiedMapboxError {
  const { status, name, rawMessage } = extractErrorDetails(eventOrError);
  const lower = rawMessage.toLowerCase();

  if (
    name === "AbortError" ||
    lower === "abort" ||
    /\b(abort|aborted|cancel|canceled|cancelled)\b/i.test(rawMessage)
  ) {
    return {
      kind: "ignore",
      status,
      message: rawMessage || "Request aborted",
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    /unauthorized|forbidden|invalid access token|not authorized/i.test(lower)
  ) {
    const originHint =
      typeof window !== "undefined" && window.location?.origin
        ? ` (${window.location.origin})`
        : "";
    return {
      kind: "auth",
      status,
      message:
        status === 403
          ? `Mapbox rejected requests from this origin${originHint}. Verify the Mapbox token URL restrictions allow this site.`
          : "Mapbox authentication failed. Check VITE_MAPBOX_ACCESS_TOKEN.",
    };
  }

  if (/webgl|failed to initialize|context lost|gpu/i.test(lower)) {
    return {
      kind: "webgl",
      status,
      message: rawMessage || "Mapbox WebGL graphics context error.",
    };
  }

  if (!rawMessage && status === undefined) {
    return {
      kind: "ignore",
      message: "",
    };
  }

  return {
    kind: "transient",
    status,
    message:
      rawMessage ||
      (status ? `Map tile request delayed (HTTP ${status}). Retrying automatically…` : "Map tiles delayed — retrying automatically…"),
  };
}

/** Resize a Mapbox GL map only when its container has non-zero layout dimensions. */
export function safeResizeMap(map: any, container: HTMLElement | null): void {
  if (!map || !container) return;
  if (container.clientWidth > 0 && container.clientHeight > 0) {
    try {
      map.resize?.();
    } catch {
      // Ignore resize errors while map is tearing down
    }
  }
}

/** Recover a Mapbox instance in place after transient style/network disruption without replacing the map. */
export function recoverMapboxStyleInPlace(map: any, styleUrl: string): void {
  if (!map) return;
  try {
    const loaded = typeof map.isStyleLoaded === "function" ? map.isStyleLoaded() : false;
    if (!loaded && typeof map.setStyle === "function" && styleUrl) {
      map.setStyle(styleUrl);
    } else {
      map.triggerRepaint?.();
      map.resize?.();
    }
  } catch {
    // Best-effort in-place recovery
  }
}
