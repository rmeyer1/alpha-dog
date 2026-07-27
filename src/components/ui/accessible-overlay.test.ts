// @vitest-environment jsdom

import { createElement, createRef, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessibleOverlay } from "./accessible-overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function pressKey(key: string, shiftKey = false) {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      shiftKey,
    }),
  );
}

async function flushFrames() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AccessibleOverlay", () => {
  it("isolates the background, traps focus, closes on Escape, and restores focus", async () => {
    const appRoot = document.createElement("div");
    const portalRoot = document.createElement("div");
    const trigger = document.createElement("button");
    const reactRoot = createRoot(appRoot);

    portalRoot.id = "alpha-dog-overlay-root";
    trigger.textContent = "Open";
    document.body.append(appRoot, trigger, portalRoot);
    trigger.focus();

    function Harness() {
      const [open, setOpen] = useState(true);
      const firstFieldRef = createRef<HTMLInputElement>();

      return open
        ? createElement(
            AccessibleOverlay,
            {
              description: "Keyboard-contained account action.",
              initialFocusRef: firstFieldRef,
              label: "Test overlay",
              onClose: () => setOpen(false),
            },
            createElement("input", { "aria-label": "First", ref: firstFieldRef }),
            createElement("button", null, "Last"),
          )
        : null;
    }

    await act(async () => {
      reactRoot.render(createElement(Harness));
    });
    await flushFrames();

    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    const first = document.querySelector<HTMLInputElement>(
      "input[aria-label='First']",
    );
    const last = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Last",
    );

    expect(dialog?.getAttribute("aria-label")).toBe("Test overlay");
    expect(dialog?.textContent).toContain("Keyboard-contained account action.");
    expect(appRoot.inert).toBe(true);
    expect(trigger.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(first);

    last?.focus();
    pressKey("Tab");
    expect(document.activeElement).toBe(first);

    first?.focus();
    pressKey("Tab", true);
    expect(document.activeElement).toBe(last);

    await act(async () => {
      pressKey("Escape");
    });
    await flushFrames();

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(appRoot.inert).toBe(false);
    expect(trigger.inert).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);

    await act(async () => {
      reactRoot.unmount();
    });
  });

  it("keeps only the top stacked overlay interactive", async () => {
    const appRoot = document.createElement("div");
    const portalRoot = document.createElement("div");
    const reactRoot = createRoot(appRoot);

    portalRoot.id = "alpha-dog-overlay-root";
    document.body.append(appRoot, portalRoot);

    function Harness() {
      const [nestedOpen, setNestedOpen] = useState(true);

      return createElement(
        AccessibleOverlay,
        {
          description: "Underlying detail.",
          label: "Detail",
          onClose: vi.fn(),
        },
        createElement("button", null, "Detail action"),
        nestedOpen
          ? createElement(
              AccessibleOverlay,
              {
                description: "Nested confirmation.",
                label: "Confirmation",
                onClose: () => setNestedOpen(false),
              },
              createElement("button", null, "Confirm action"),
            )
          : null,
      );
    }

    await act(async () => {
      reactRoot.render(createElement(Harness));
    });
    await flushFrames();

    const hosts = Array.from(
      document.querySelectorAll<HTMLElement>("[data-alpha-dog-overlay-root]"),
    );
    const detailHost = hosts.find(
      (host) => host.getAttribute("aria-label") === "Detail",
    );
    const confirmationHost = hosts.find(
      (host) => host.getAttribute("aria-label") === "Confirmation",
    );

    expect(hosts).toHaveLength(2);
    expect(detailHost?.inert).toBe(true);
    expect(confirmationHost?.inert).toBe(false);

    await act(async () => {
      pressKey("Escape");
    });
    await flushFrames();

    const remainingHosts = Array.from(
      document.querySelectorAll<HTMLElement>("[data-alpha-dog-overlay-root]"),
    );

    expect(remainingHosts.map((host) => ({
      inert: host.inert,
      label: host.getAttribute("aria-label"),
    }))).toEqual([{ inert: false, label: "Detail" }]);

    await act(async () => {
      reactRoot.unmount();
    });
  });
});
