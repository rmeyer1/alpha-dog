import { describe, expect, it, vi } from "vitest";
import { readBoundedBody } from "./read-bounded-body";

function chunkedBody(
  chunks: Uint8Array[],
  cancel = vi.fn(),
) {
  return {
    cancel,
    stream: new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        const chunk = chunks.shift();

        if (chunk) {
          controller.enqueue(chunk);
          return;
        }

        controller.close();
      },
    }),
  };
}

describe("readBoundedBody", () => {
  it("returns an empty body when the response has no stream", async () => {
    await expect(readBoundedBody(null, 10)).resolves.toEqual({
      bytes: new Uint8Array(),
      status: "ok",
    });
  });

  it("joins chunks whose total is exactly the limit", async () => {
    const { stream } = chunkedBody([
      new Uint8Array([1, 2]),
      new Uint8Array(),
      new Uint8Array([3, 4]),
    ]);

    await expect(readBoundedBody(stream, 4)).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3, 4]),
      status: "ok",
    });
  });

  it("stops and cancels without retaining an over-limit chunk", async () => {
    const cancel = vi.fn();
    const { stream } = chunkedBody([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4, 5]),
      new Uint8Array([6]),
    ], cancel);

    await expect(readBoundedBody(stream, 4)).resolves.toEqual({
      status: "too-large",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("still reports overflow when the underlying cancellation rejects", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));
    const { stream } = chunkedBody([new Uint8Array([1, 2])], cancel);

    await expect(readBoundedBody(stream, 1)).resolves.toEqual({
      status: "too-large",
    });
  });

  it("propagates read failures and releases the reader lock", async () => {
    const failure = new Error("read failed");
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure);
      },
    });
    const reader = stream.getReader();
    const releaseLock = vi.spyOn(reader, "releaseLock");
    vi.spyOn(stream, "getReader").mockReturnValue(reader);

    await expect(readBoundedBody(stream, 10)).rejects.toBe(failure);
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid byte limit %s",
    async (maxBytes) => {
      await expect(readBoundedBody(null, maxBytes)).rejects.toThrow(RangeError);
    },
  );
});
