export async function withProfileLabels<T>(
  _labels: Record<string, string | number>,
  fn: () => Promise<T> | T
): Promise<T> {
  return await fn();
}

class Profiler {
  private isProfiling = false;
  private startedAt = 0;

  public async start() {
    if (typeof window !== "undefined" || process.env.NEXT_RUNTIME !== "nodejs") return;
    try {
      const { time } = await import("@datadog/pprof");
      if (this.isProfiling || time.isStarted()) return;

      this.startedAt = Date.now();
      time.start({
        durationMillis: 60000,
        intervalMicros: 10000,
        withContexts: false, // Node.js 20, 22, 24+ safe
      });
      this.isProfiling = true;
    } catch (err) {
      console.warn("[Profiler] Native CPU profiler unavailable:", (err as Error)?.message || err);
    }
  }

  public async stopAndUpload(): Promise<boolean> {
    if (typeof window !== "undefined" || process.env.NEXT_RUNTIME !== "nodejs") return false;

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

      const buffer = await encode(profile);

      const url = new URL(`${serverAddress.replace(/\/+$/, "")}/ingest`);
      url.searchParams.append("format", "pprof");
      url.searchParams.append("name", appName);
      url.searchParams.append("spyName", "nodespy");
      url.searchParams.append("from", Math.floor(startedAt / 1000).toString());
      url.searchParams.append("until", Math.max(Math.floor(stoppedAt / 1000), Math.floor(startedAt / 1000) + 1).toString());
      url.searchParams.append("sampleRate", "100");

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

      return res.ok;
    } catch (err) {
      console.warn("[Profiler] Upload skipped:", (err as Error)?.message || err);
      return false;
    }
  }
}

export const profiler = new Profiler();
