import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Admin has two catalog pages: Models & pricing (prices and packages) and Providers & balances (keys, balances,
      // spending, routing). Old links and bookmarks land on the page that now holds the same work; the query string is
      // kept, so /admin/pricing?tab=packages opens the packages section and ?model=<id> opens that model.
      { source: "/admin/pricing", destination: "/admin/catalog", permanent: false },
      { source: "/admin/balances", destination: "/admin/providers", permanent: false },
      { source: "/admin/kie", destination: "/admin/providers", permanent: false },
    ];
  },
};

export default nextConfig;
