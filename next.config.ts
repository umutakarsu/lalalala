import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Scout is App Router only. Sync route handlers live in app/api/*,
  // async/scheduled/integration work lives in n8n (see ARCHITECTURE.md).
  experimental: {},
};

export default nextConfig;
