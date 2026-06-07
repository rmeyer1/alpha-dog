import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withWorkflow } from "workflow/next";

const currentDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: currentDir,
  },
};

export default withWorkflow(nextConfig);
