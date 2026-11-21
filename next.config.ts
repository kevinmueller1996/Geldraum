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
  async redirects() {
    // Send public page visits directly to the landing page. Offline shell requests,
    // local development and returning browser sessions keep the dashboard route.
    return [{
      source: "/",
      has: [
        { type: "host", value: "njora\\.de" },
        { type: "header", key: "accept", value: ".*text/html.*" },
      ],
      missing: [
        { type: "cookie", key: "__Host-njora_session" },
        { type: "cookie", key: "geldraum_session" },
        { type: "cookie", key: "__Host-njora_browser" },
      ],
      destination: "/login",
      permanent: false,
    }];
  },
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
    }, {
      source: "/api/chatgpt/authorize",
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self' https://chatgpt.com/connector_platform_oauth_redirect; frame-ancestors 'none'; base-uri 'none'" },
        { key: "Referrer-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default nextConfig;
