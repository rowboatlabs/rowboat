import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "export",
  turbopack: {
    // Keep Turbopack scoped to this app instead of inferring a parent workspace root.
    root: __dirname || path.join(process.cwd()),
  },
};

export default nextConfig;
