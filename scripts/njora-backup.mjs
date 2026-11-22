// RSA-OAEP-SHA256 + AES-256-GCM, using the Rheinland Suite envelope with Njora's own authenticated context.
import { constants, createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, randomBytes, randomUUID } from "node:crypto";
import { readFile, open, link, unlink, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";

const ENDPOINT = "https://njora.de/api/admin/backup";
const FORMAT = "rs-suite-backup-encrypted";
const ALGORITHM = "RSA-OAEP-SHA256+A256GCM";
const MAX_EXPORT = 64 * 1024 * 1024;
const MAX_ARCHIVE = 90 * 1024 * 1024;
const restoreScript = fileURLToPath(new URL("./restore-njora-backup.py", import.meta.url));
const rsa = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" };

class BackupError extends Error {}

function fingerprint(key) {
  if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength < 2048) {
    throw new BackupError("Ein RSA-Empfängerschlüssel mit mindestens 2048 Bit ist erforderlich.");
  }
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

function context(keyId) {
  return Buffer.from(FORMAT + ":1:njora:" + keyId);
}

async function download(token, fetchImpl) {
  if (!token?.trim()) throw new BackupError("NJORA_BACKUP_EXPORT_TOKEN fehlt.");
  const response = await fetchImpl(ENDPOINT, {
    headers: { "x-njora-backup-token": token.trim(), accept: "application/json" },
    signal: AbortSignal.timeout(120_000), redirect: "error", cache: "no-store",
  });
  if (response.status !== 200 || !response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) {
    await response.body?.cancel();
    throw new BackupError("Export abgelehnt oder unerwarteter Inhalt (HTTP " + response.status + ").");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_EXPORT) throw new BackupError("Der Export überschreitet 64 MiB.");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, size);
  const data = JSON.parse(bytes);
  const tables = ["users", "finance_plans", "user_activity", "auth_credentials"];
  if (data?.version >= 2) tables.push("njora_subscribers");
  if (data?.version === 3) tables.push("business_plans");
  if (data?.format !== "njora-database-backup" || ![1, 2, 3].includes(data.version)
      || !data.tables || Object.keys(data.tables).length !== tables.length
      || !tables.every(name => Array.isArray(data.tables[name]))) {
    throw new BackupError("Die Antwort enthält keinen vollständigen Njora-Export.");
  }
  return bytes;
}

export async function createBackup(directory, publicPem, token, fetchImpl = fetch) {
  if (!publicPem.toString().trimStart().startsWith("-----BEGIN PUBLIC KEY-----")) {
    throw new BackupError("Der Sicherungsjob benötigt den öffentlichen PEM-Schlüssel.");
  }
  const recipient = createPublicKey(publicPem);
  const keyId = fingerprint(recipient);
  const clear = await download(token, fetchImpl);
  const key = randomBytes(32);
  const iv = randomBytes(12);
  let envelope;
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(context(keyId));
    const encrypted = Buffer.concat([cipher.update(gzipSync(clear)), cipher.final(), cipher.getAuthTag()]);
    const wrapped = publicEncrypt({ ...rsa, key: recipient }, key);
    envelope = JSON.stringify({ format: FORMAT, version: 1, keyId, algorithm: ALGORITHM,
      iv: iv.toString("base64"), wrappedKey: wrapped.toString("base64"), ciphertext: encrypted.toString("base64") });
  } finally {
    key.fill(0);
    clear.fill(0);
  }
  const name = "njora-" + new Date().toISOString().replace(/:/g, "-") + "-" + randomUUID() + ".json.enc";
  const target = join(directory, name);
  const partial = join(directory, "." + name + ".part");
  const file = await open(partial, "wx", 0o600);
  try {
    try {
      await file.writeFile(envelope);
      await file.sync();
    } finally {
      await file.close();
    }
    // A complete file becomes visible in one operation; retries cannot overwrite any earlier backup.
    await link(partial, target);
  } finally {
    await unlink(partial);
  }
  const folder = await open(directory, "r");
  try { await folder.sync(); } finally { await folder.close(); }
  return target;
}

export async function restoreBackup(source, privatePem, destination, passphrase) {
  if ((await stat(source)).size > MAX_ARCHIVE) throw new BackupError("Archiv überschreitet 90 MiB.");
  const envelope = JSON.parse(await readFile(source, "utf8"));
  const recipient = createPrivateKey({ key: privatePem, passphrase });
  const keyId = fingerprint(createPublicKey(recipient));
  if (envelope.format !== FORMAT || envelope.version !== 1 || envelope.algorithm !== ALGORITHM || envelope.keyId !== keyId) {
    throw new BackupError("Archivformat oder Empfängerschlüssel stimmt nicht.");
  }
  const key = privateDecrypt({ ...rsa, key: recipient }, Buffer.from(envelope.wrappedKey, "base64"));
  let clear;
  try {
    const payload = Buffer.from(envelope.ciphertext, "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    if (iv.length !== 12 || payload.length <= 16) throw new BackupError("Archiv ist unvollständig.");
    const cipher = createDecipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(context(keyId));
    cipher.setAuthTag(payload.subarray(-16));
    const compressed = Buffer.concat([cipher.update(payload.subarray(0, -16)), cipher.final()]);
    clear = gunzipSync(compressed, { maxOutputLength: MAX_EXPORT });
    const result = spawnSync("python3", [restoreScript, "-", destination], {
      input: clear, stdio: ["pipe", "ignore", "pipe"], env: { PATH: process.env.PATH },
    });
    if (result.error || result.status !== 0) throw new BackupError("SQLite-Restore fehlgeschlagen. Ziel muss neu sein, Migrationen und Python müssen vorliegen.");
  } finally {
    key.fill(0);
    clear?.fill(0);
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "create" && args.length === 2) {
    const saved = await createBackup(args[0], await readFile(args[1]), process.env.NJORA_BACKUP_EXPORT_TOKEN);
    console.log("Verschlüsselt gespeichert:", basename(saved));
  } else if (command === "restore" && args.length === 3) {
    await restoreBackup(args[0], await readFile(args[1]), args[2], process.env.NJORA_RECOVERY_PASSPHRASE);
    console.log("Wiederherstellung und SQLite-Integritätsprüfung erfolgreich.");
  } else throw new BackupError("Aufruf: create ZIELVERZEICHNIS PUBLIC.pem oder restore ARCHIV PRIVATE.pem NEUE.sqlite");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Parse errors and downstream errors may contain export data or credentials.
    console.error(error instanceof BackupError ? error.message : "Sicherung fehlgeschlagen. Verbindung, Schlüssel und Dateiberechtigungen prüfen.");
    process.exitCode = 1;
  });
}
