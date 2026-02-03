import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Turbopack for build since keytar doesn't work with it
  // Use webpack instead
  experimental: {
    // This ensures keytar and other native modules work properly
  },
  // Mark native modules as external
  serverExternalPackages: ['keytar', '@journeyapps/sqlcipher', 'better-sqlite3'],
};

export default nextConfig;
