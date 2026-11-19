import { isLocalHostname } from "./local-host";

export function markerName(host: string) {
  return isLocalHostname(host) ? "njora_browser" : "__Host-njora_browser";
}

export function expireMarker(url: string) {
  const host = new URL(url).hostname;
  return markerName(host) + "=; Path=/; SameSite=Lax; Max-Age=0" + (isLocalHostname(host) ? "" : "; Secure");
}
