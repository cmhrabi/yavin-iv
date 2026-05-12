import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@cmhrabi/yavin-protocol"],
  experimental: {
    typedRoutes: false,
  },
};

export default config;
