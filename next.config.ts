import type { NextConfig } from "next";
import path from "node:path";

const vercelWorkersShim = path.resolve(process.cwd(), "app/vercel/cloudflare-workers.ts");
const isVercelBuild = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  ...(isVercelBuild ? {
    turbopack: {
      resolveAlias: {
        "cloudflare:workers": "./app/vercel/cloudflare-workers.ts",
      },
    },
    webpack(config) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "cloudflare:workers": vercelWorkersShim,
      };
      return config;
    },
  } : {}),
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ],
    }];
  },
};

export default nextConfig;
