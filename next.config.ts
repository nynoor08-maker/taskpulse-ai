import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://checkout.stripe.com; object-src 'none'; script-src 'self' 'unsafe-inline' https://js.stripe.com https://checkout.stripe.com; connect-src 'self' https://*.supabase.co https://api.stripe.com https://*.ingest.sentry.io; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-src https://js.stripe.com https://checkout.stripe.com",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
