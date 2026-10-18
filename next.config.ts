import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The KIE balance page became Supplier balances (all suppliers); old links and bookmarks land there.
      { source: "/admin/kie", destination: "/admin/balances", permanent: false },
    ];
  },
};

export default nextConfig;
