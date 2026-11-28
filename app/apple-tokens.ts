const issuer = "https://appleid.apple.com";
const utf8 = new TextEncoder();

export function appleEncode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
}

function encodedJSON(value: unknown) {
  return appleEncode(utf8.encode(JSON.stringify(value)));
}

export function randomAppleValue() {
  return appleEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashAppleValue(value: string) {
  return appleEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode(value))));
}

function parsePart(part: string) {
  const object: unknown = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(decode(part)));
  if (!object || typeof object !== "object" || Array.isArray(object)) throw new Error("Invalid JWT");
  return object as Record<string, unknown>;
}

export async function verifyAppleToken(token: string, audiences: string[], loadKeys: (kid: string) => Promise<JsonWebKey | undefined>,
                                       now = Math.floor(Date.now() / 1000), kind: "identity" | "notification" = "identity") {
  if (token.length > 12_000) throw new Error("Invalid Apple token length");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid Apple token");
  const [header, payload, signature] = parts;
  const {kid, alg} = parsePart(header);
  if (alg !== "RS256" || typeof kid !== "string" || !kid || kid.length > 128) throw new Error("Invalid Apple token algorithm");
  const jwk = await loadKeys(kid);
  if (!jwk || jwk.kty !== "RSA" || (jwk.alg && jwk.alg !== "RS256") || (jwk.use && jwk.use !== "sig")) throw new Error("Unknown Apple signing key");
  const key = await crypto.subtle.importKey("jwk", jwk, {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"}, false, ["verify"]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(signature), utf8.encode(header + "." + payload))) {
    throw new Error("Invalid Apple signature");
  }
  const claims = parsePart(payload);
  if (claims.iss !== issuer || typeof claims.aud !== "string" || !audiences.includes(claims.aud)) throw new Error("Invalid Apple issuer or audience");
  const expiryValid = kind === "notification" && claims.exp === undefined ||
    typeof claims.exp === "number" && Number.isFinite(claims.exp) && claims.exp > now;
  if (typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > now + 60 || !expiryValid ||
      (kind === "notification" && claims.iat < now - 7 * 86400)) throw new Error("Expired Apple token");
  return claims;
}

export async function signAppleClientSecret(clientId: string, teamId: string, keyId: string, privateKey: string) {
  const pem = privateKey.replaceAll("\\n", "\n").replace(/-----[^-]+-----|\s/g, "");
  const bytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", bytes, {name: "ECDSA", namedCurve: "P-256"}, false, ["sign"]);
  const iat = Math.floor(Date.now() / 1000);
  const payload = encodedJSON({alg: "ES256", kid: keyId}) + "." +
    encodedJSON({iss: teamId, sub: clientId, aud: issuer, iat, exp: iat + 300});
  const signature = await crypto.subtle.sign({name: "ECDSA", hash: "SHA-256"}, key, utf8.encode(payload));
  return payload + "." + appleEncode(new Uint8Array(signature));
}

async function tokenKey(secret: string) {
  const key = decode(secret);
  if (key.byteLength !== 32) throw new Error("A 256-bit token encryption key is required");
  return crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealAppleRefreshToken(token: string, secret: string, subject: string, clientId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: utf8.encode(subject + "|" + clientId)},
    await tokenKey(secret), utf8.encode(token));
  return "v1:" + appleEncode(iv) + ":" + appleEncode(new Uint8Array(encrypted));
}

export async function openAppleRefreshToken(value: string, secret: string, subject: string, clientId: string) {
  const [version, iv, encrypted, extra] = value.split(":");
  if (version !== "v1" || !iv || !encrypted || extra !== undefined) throw new Error("Unknown Apple token format");
  const plain = await crypto.subtle.decrypt({name: "AES-GCM", iv: decode(iv), additionalData: utf8.encode(subject + "|" + clientId)},
    await tokenKey(secret), decode(encrypted));
  return new TextDecoder().decode(plain);
}
