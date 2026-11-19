import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phase 7 Task 7: do not advertise the framework (X-Powered-By).
  poweredByHeader: false,
  // Phase 5 Task 6 (ADR-057): the optimiser serves only allowlisted sources
  // (src/lib/images.ts mirrors this list; the CSP img-src matches it).
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
    // Same-origin: uploads, plus the site's own marketing and UI artwork.
    localPatterns: [
      { pathname: "/uploads/**", search: "" },
      { pathname: "/marketing/**", search: "" },
      { pathname: "/ui/**", search: "" },
      // Portal mastheads (ADR-071).
      { pathname: "/banners/**", search: "" },
    ],
    formats: ["image/avif", "image/webp"],
  },
  logging: {
    // Confirmation URLs contain one-time token hashes. Keep those request
    // paths out of development logs; application code also never logs them.
    incomingRequests: { ignore: [/\/auth\/confirm/] },
    // Development logs print every Server Function call with its arguments,
    // which would put login, sign-up and reset passwords in plain text in the
    // terminal and any captured log file. Production never logs these calls.
    serverFunctions: false,
  },
  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ];
    if (process.env.NODE_ENV === "production") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    }

    return [
      { source: "/:path*", headers },
      {
        source: "/auth/confirm",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
        ],
      },
      {
        // Agent invitation (ADR-023): the token is in the URL fragment, but
        // keep the page uncached and referrer-free as defence in depth.
        source: "/invite/agent",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/reset-password",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
