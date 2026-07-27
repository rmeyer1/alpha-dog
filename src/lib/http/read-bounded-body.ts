export type BoundedBodyReadResult =
  | { bytes: Uint8Array<ArrayBuffer>; status: "ok" }
  | { status: "too-large" };

export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<BoundedBodyReadResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }

  if (!body) {
    return { bytes: new Uint8Array(), status: "ok" };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value.byteLength) {
        continue;
      }

      byteLength += value.byteLength;

      if (byteLength > maxBytes) {
        try {
          await reader.cancel("response body exceeded the configured limit");
        } catch {
          // The reader is still abandoned and its lock released below.
        }

        return { status: "too-large" };
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { bytes, status: "ok" };
}
