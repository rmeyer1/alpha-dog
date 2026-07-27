import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withWorkflow } from "workflow/next";
import { buildSecurityHeaders } from "./src/lib/security/headers";

const currentDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: currentDir,
  },
  async headers() {
    return [
      {
        headers: buildSecurityHeaders(),
        source: "/:path*",
      },
    ];
  },
};

export default withWorkflow(nextConfig);
