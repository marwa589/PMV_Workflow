import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    middlewareClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
