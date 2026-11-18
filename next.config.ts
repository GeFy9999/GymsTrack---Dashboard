import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "googleapis"],
  // Image Docker légère (voir Dockerfile).
  output: "standalone",
};

export default nextConfig;
