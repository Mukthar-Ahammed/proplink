import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    // Confirmation URLs contain one-time token hashes. Keep those request
    // paths out of development logs; application code also never logs them.
    incomingRequests: { ignore: [/\/auth\/confirm/] },
  },
  async headers() {
    return [
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
