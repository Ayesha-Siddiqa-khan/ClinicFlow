export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: number;
  nanoOffset: number;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getActiveLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (envLevel && envLevel in LEVEL_SEVERITY) {
    return envLevel;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

class Logger {
  private buffer: LogEntry[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private nanoCounter = 0;
  private remoteWarningEmitted = false;

  private get lokiHost(): string | null {
    if (typeof window !== "undefined") return null;
    return process.env.LOKI_HOST || process.env.LOKI_URL || null;
  }

  private get otlpEndpoint(): string | null {
    if (typeof window !== "undefined") return null;
    return process.env.OTEL_EXPORTER_OTLP_ENDPOINT || null;
  }

  private get isRemoteLoggingConfigured(): boolean {
    return Boolean(this.lokiHost || this.otlpEndpoint);
  }

  private get appName(): string {
    return process.env.OTEL_SERVICE_NAME || process.env.LOKI_APP_NAME || "clinic-flow";
  }

  private shouldLog(level: LogLevel): boolean {
    const currentSeverity = LEVEL_SEVERITY[getActiveLogLevel()];
    const targetSeverity = LEVEL_SEVERITY[level];
    return targetSeverity >= currentSeverity;
  }

  public debug(message: string, meta?: Record<string, unknown>) {
    this.log("debug", message, meta);
  }

  public info(message: string, meta?: Record<string, unknown>) {
    this.log("info", message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>) {
    this.log("warn", message, meta);
  }

  public error(message: string, errorOrMeta?: Error | Record<string, unknown>, extraMeta?: Record<string, unknown>) {
    let combinedMeta: Record<string, unknown> = {};

    if (errorOrMeta instanceof Error) {
      combinedMeta = {
        errorMessage: errorOrMeta.message,
        errorStack: errorOrMeta.stack,
        ...extraMeta,
      };
    } else if (errorOrMeta) {
      combinedMeta = { ...errorOrMeta, ...extraMeta };
    }

    this.log("error", message, combinedMeta);
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (!this.shouldLog(level)) return;

    // 1. Console Output
    const timestampStr = new Date().toISOString();
    const metaStr = meta && Object.keys(meta).length > 0 ? " " + JSON.stringify(meta) : "";
    const formattedConsole = `[${timestampStr}] [${level.toUpperCase()}] [${this.appName}] ${message}${metaStr}`;

    switch (level) {
      case "error":
        console.error(formattedConsole);
        break;
      case "warn":
        console.warn(formattedConsole);
        break;
      case "debug":
        console.debug(formattedConsole);
        break;
      default:
        console.log(formattedConsole);
    }

    // 2. Queue for remote logging (Loki or OTLP Gateway) if configured and on server
    if (this.isRemoteLoggingConfigured) {
      this.nanoCounter = (this.nanoCounter + 1) % 10000;
      this.buffer.push({
        timestamp: Date.now(),
        nanoOffset: this.nanoCounter,
        level,
        message,
        meta,
      });

      if (this.buffer.length >= 25) {
        void this.flush();
      } else if (!this.flushTimeout) {
        this.flushTimeout = setTimeout(() => {
          this.flushTimeout = null;
          void this.flush();
        }, 1000);
      }
    }
  }

  public async flush(): Promise<void> {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    if (this.buffer.length === 0 || this.isFlushing || !this.isRemoteLoggingConfigured) {
      return;
    }

    this.isFlushing = true;
    const batch = [...this.buffer];
    this.buffer = [];

    try {
      if (this.lokiHost) {
        await this.sendToLoki(batch);
      } else if (this.otlpEndpoint) {
        await this.sendToOtlp(batch);
      }
      this.remoteWarningEmitted = false;
    } catch (err) {
      if (!this.remoteWarningEmitted) {
        console.warn("[Logger] Unable to push logs to remote endpoint:", (err as Error)?.message || err);
        this.remoteWarningEmitted = true;
      }
      // Drop batch to prevent memory leak if remote is offline
    } finally {
      this.isFlushing = false;
    }
  }

  private async sendToLoki(entries: LogEntry[]): Promise<void> {
    const host = this.lokiHost;
    if (!host) return;

    const endpoint = host.endsWith("/") ? `${host}loki/api/v1/push` : `${host}/loki/api/v1/push`;
    const environment = process.env.NODE_ENV || "development";

    // Group entries by level so each stream has clean labels
    const streamsMap = new Map<LogLevel, Array<[string, string]>>();

    for (const entry of entries) {
      const nanoTs = (BigInt(entry.timestamp) * BigInt(1000000) + BigInt(entry.nanoOffset)).toString();
      const logBody = JSON.stringify({
        message: entry.message,
        timestamp: new Date(entry.timestamp).toISOString(),
        ...(entry.meta || {}),
      });

      const list = streamsMap.get(entry.level) || [];
      list.push([nanoTs, logBody]);
      streamsMap.set(entry.level, list);
    }

    const streams = Array.from(streamsMap.entries()).map(([level, values]) => ({
      stream: {
        service_name: this.appName,
        job: this.appName,
        app: this.appName,
        service: this.appName,
        environment,
        level,
      },
      values,
    }));

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (process.env.LOKI_TENANT_ID) {
      headers["X-Scope-OrgID"] = process.env.LOKI_TENANT_ID;
    }

    if (process.env.LOKI_BASIC_AUTH_USER && process.env.LOKI_BASIC_AUTH_PASSWORD) {
      const creds = Buffer.from(
        `${process.env.LOKI_BASIC_AUTH_USER}:${process.env.LOKI_BASIC_AUTH_PASSWORD}`
      ).toString("base64");
      headers["Authorization"] = `Basic ${creds}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ streams }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Loki returned ${res.status}: ${text}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async sendToOtlp(entries: LogEntry[]): Promise<void> {
    const baseEndpoint = this.otlpEndpoint;
    if (!baseEndpoint) return;

    const endpoint = baseEndpoint.replace(/\/+$/, "") + "/v1/logs";
    const environment = process.env.NODE_ENV || "development";

    const logRecords = entries.map((entry) => {
      const timeUnixNano = (BigInt(entry.timestamp) * BigInt(1000000) + BigInt(entry.nanoOffset)).toString();
      const attributes: Array<{ key: string; value: { stringValue: string } }> = [
        { key: "service.name", value: { stringValue: this.appName } },
        { key: "service_name", value: { stringValue: this.appName } },
        { key: "job", value: { stringValue: this.appName } },
        { key: "app", value: { stringValue: this.appName } },
        { key: "level", value: { stringValue: entry.level } },
        { key: "environment", value: { stringValue: environment } },
      ];

      if (entry.meta) {
        for (const [k, v] of Object.entries(entry.meta)) {
          if (v !== undefined && v !== null) {
            attributes.push({
              key: k,
              value: { stringValue: typeof v === "object" ? JSON.stringify(v) : String(v) },
            });
          }
        }
      }

      return {
        timeUnixNano,
        severityText: entry.level.toUpperCase(),
        body: { stringValue: entry.message },
        attributes,
      };
    });

    const body = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: this.appName } },
              { key: "job", value: { stringValue: this.appName } },
              { key: "app", value: { stringValue: this.appName } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: this.appName },
              logRecords,
            },
          ],
        },
      ],
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (process.env.OTEL_EXPORTER_OTLP_HEADERS) {
      const pairs = process.env.OTEL_EXPORTER_OTLP_HEADERS.split(",");
      for (const pair of pairs) {
        const [rawK, ...rest] = pair.split("=");
        if (rawK && rest.length > 0) {
          headers[rawK.trim()] = rest.join("=").trim();
        }
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OTLP Gateway returned ${res.status}: ${text}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const logger = new Logger();
