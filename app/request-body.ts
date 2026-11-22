// Request bodies may be chunked and have no Content-Length. Count actual bytes
// before buffering them for JSON decoding or forwarding to the hosted backend.
export async function readBodyBytes(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new RangeError("Body too large");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RangeError("Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// These endpoints accept short fields such as an email address, token or cancellation
// reason. Only the plan upload needs a larger document.
export const formBodyLimit = 16_384;

export async function readFormObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const bytes = await readBodyBytes(request, formBodyLimit);
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
