import type { NextConfig } from "next";

const vercelWorkersShim = `${process.cwd()}/app/vercel/cloudflare-workers.ts`;
const isVercelBuild = process.env.VERCEL === "1";
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
        ...(process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy }] : []),
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
