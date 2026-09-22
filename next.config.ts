import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.trycloudflare.com"],
  experimental: {
    middlewareClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
