export function isLocalHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}
