import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@datadog/pprof", "@pyroscope/nodejs"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@datadog/pprof/**/*"],
  },
};

export default nextConfig;

