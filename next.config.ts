import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@yavin/protocol"],
  experimental: {
    typedRoutes: false,
  },
};

export default config;
