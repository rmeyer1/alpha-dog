import { describe, expect, it, vi } from "vitest";
import {
  isAbortError,
  LatestRequestLifecycle,
} from "./request-lifecycle";

describe("LatestRequestLifecycle", () => {
  it("aborts superseded work and rejects its out-of-order completion", () => {
    const lifecycle = new LatestRequestLifecycle();
    const first = lifecycle.begin();
    const second = lifecycle.begin();
    const commit = vi.fn();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(lifecycle.commit(first, () => commit("first"))).toBe(false);
    expect(lifecycle.commit(second, () => commit("second"))).toBe(true);
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith("second");
  });

  it("keeps loading ownership with the newest request", () => {
    const lifecycle = new LatestRequestLifecycle();
    const first = lifecycle.begin();
    const second = lifecycle.begin();

    expect(lifecycle.finish(first)).toBe(false);
    expect(lifecycle.isActive(second)).toBe(true);
    expect(lifecycle.finish(second)).toBe(true);
    expect(lifecycle.isActive(second)).toBe(false);
  });

  it("explicitly aborts active work and releases its ownership", () => {
    const lifecycle = new LatestRequestLifecycle();
    const token = lifecycle.begin();

    lifecycle.abort();

    expect(token.signal.aborted).toBe(true);
    expect(lifecycle.isActive(token)).toBe(false);
    expect(lifecycle.commit(token, vi.fn())).toBe(false);
  });

  it("distinguishes aborts from genuine failures", () => {
    const abort = new Error("cancelled");
    abort.name = "AbortError";

    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError(new Error("provider failed"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});
