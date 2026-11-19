export const issuer = "https://njora.de";
export const base = "/api/chatgpt";
export const resource = issuer + base + "/mcp";
export const metadata = issuer + "/.well-known/oauth-protected-resource";
export const clientId = "njora-chatgpt";
export const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
export const scopes = ["njora:read", "njora:write"];

export const resourceInfo = { resource, authorization_servers: [issuer], scopes_supported: scopes, bearer_methods_supported: ["header"], resource_name: "Njora" };
export const issuerInfo = {
  issuer, authorization_endpoint: issuer + base + "/authorize",
  token_endpoint: issuer + base + "/token", revocation_endpoint: issuer + base + "/revoke",
  response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
  scopes_supported: scopes, code_challenge_methods_supported: ["S256"],
  authorization_response_iss_parameter_supported: true, token_endpoint_auth_methods_supported: ["none"],
  revocation_endpoint_auth_methods_supported: ["none"]
};

export function scopeSet(value: string | null): string | null {
  const list = new Set((value ?? "").split(" ").filter(Boolean));
  return list.has(scopes[0]) && [...list].every(s => scopes.includes(s))
    ? scopes.filter(s => list.has(s)).join(" ") : null;
}

export function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
}
export async function hash(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))));
}
export const tokenShape = /^[A-Za-z0-9_-]{43}$/;

