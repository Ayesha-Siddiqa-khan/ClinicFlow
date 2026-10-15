export async function withProfileLabels<T>(
  _labels: Record<string, string | number>,
  fn: () => Promise<T> | T
): Promise<T> {
  return await fn();
}

const V8_TO_GOLANG_MAP: Record<string, string> = {
  objects: "inuse_objects",
  sample: "samples",
  space: "inuse_space",
};

// Normalizes V8 pprof data to standard Pyroscope format expected by Grafana
function formatProfileForPyroscope(profile: any) {
  if (profile?.sampleType && profile?.stringTable?.strings) {
    for (const valType of profile.sampleType) {
      const unit = profile.stringTable.strings[Number(valType.unit)];
      if (unit && V8_TO_GOLANG_MAP[unit]) {
        valType.unit = profile.stringTable.dedup(V8_TO_GOLANG_MAP[unit]);
      }
      const type = profile.stringTable.strings[Number(valType.type)];
      if (type && V8_TO_GOLANG_MAP[type]) {
        valType.type = profile.stringTable.dedup(V8_TO_GOLANG_MAP[type]);
      }
    }
  }

  if (profile?.location && profile?.function && profile?.stringTable?.strings) {
    for (const loc of profile.location) {
      for (const line of loc.line || []) {
        const functionId = Number(line.functionId);
        const fn = profile.function[functionId - 1];
        if (fn) {
          const fnName = profile.stringTable.strings[Number(fn.name)];
          if (!fnName?.includes(":")) {
            const fileName = profile.stringTable.strings[Number(fn.filename)] || "server.js";
            const cleanName = `${fileName}:${fnName || "anonymous"}:${line.line || 1}`;
            fn.name = profile.stringTable.dedup(cleanName);
          }
        }
      }
    }
  }
}

class Profiler {
  private isProfiling = false;
  private startedAt = 0;

  public async start() {
    if (typeof window !== "undefined" || process.env.NEXT_RUNTIME === "edge") return;
    try {
      const { time } = await import("@datadog/pprof");
      if (this.isProfiling || time.isStarted()) return;

      this.startedAt = Date.now();
      time.start({
        durationMillis: 60000,
        intervalMicros: 1000, // 1000 Hz for rich sampling resolution
        withContexts: false, // Node.js 20, 22, 24+ safe
      });
      this.isProfiling = true;
    } catch (err) {
      console.warn("[Profiler] Native CPU profiler unavailable:", (err as Error)?.message || err);
    }
  }

  public async stopAndUpload(): Promise<boolean> {
    if (typeof window !== "undefined" || process.env.NEXT_RUNTIME === "edge") return false;

    try {
      const { time, encode } = await import("@datadog/pprof");
      if (!time.isStarted()) return false;

      const serverAddress = process.env.PYROSCOPE_SERVER_ADDRESS || "https://profiles-prod-018.grafana.net";
      const appName = process.env.PYROSCOPE_APPLICATION_NAME || "clinic-flow";
      const user = process.env.PYROSCOPE_BASIC_AUTH_USER;
      const password = process.env.PYROSCOPE_BASIC_AUTH_PASSWORD;

      const profile = time.stop();
      this.isProfiling = false;
      const stoppedAt = Date.now();
      const startedAt = this.startedAt || stoppedAt - 5000;

      formatProfileForPyroscope(profile);

      const buffer = await encode(profile);

      const url = new URL(`${serverAddress.replace(/\/+$/, "")}/ingest`);
      url.searchParams.append("format", "pprof");
      // Add standard Prometheus/Pyroscope labels to match Grafana panel queries
      url.searchParams.append("name", `${appName}{service_name="${appName}",app="${appName}",process_runtime_name="nodejs"}`);
      url.searchParams.append("spyName", "nodespy");
      url.searchParams.append("from", Math.floor(startedAt / 1000).toString());
      url.searchParams.append("until", Math.max(Math.floor(stoppedAt / 1000), Math.floor(startedAt / 1000) + 1).toString());
      url.searchParams.append("sampleRate", "1000");

      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
      };

      if (user && password) {
        const creds = Buffer.from(`${user}:${password}`).toString("base64");
        headers["Authorization"] = `Basic ${creds}`;
      }

      const res = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: new Uint8Array(buffer),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Profiler] Ingestion failed (${res.status} ${res.statusText}):`, errText);
        return false;
      }

      return true;
    } catch (err) {
      console.warn("[Profiler] Upload skipped:", (err as Error)?.message || err);
      return false;
    }
  }
}

export const profiler = new Profiler();
