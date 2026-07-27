"use client";

import {
  createContext,
  useEffect,
  useId,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type BackgroundState = {
  ariaHidden: string | null;
  inert: boolean;
};

type OverlayRegistration = {
  depth: number;
  host: HTMLElement;
  order: number;
  priority: number;
};

const OverlayDepthContext = createContext(0);
const overlayHosts: OverlayRegistration[] = [];
const backgroundStates = new Map<HTMLElement, BackgroundState>();
const overlayPortalId = "alpha-dog-overlay-root";
let previousBodyOverflow = "";
let previousBodyPaddingRight = "";
let isolationObserver: MutationObserver | null = null;
let overlayOrder = 0;
const subscribeToClientRuntime = () => () => undefined;

function visibleFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter((element) => {
    if (
      element.hidden ||
      element.getAttribute("aria-hidden") === "true" ||
      element.closest("[aria-hidden='true']")
    ) {
      return false;
    }

    let current: HTMLElement | null = element;

    while (current && current !== container) {
      const styles = window.getComputedStyle(current);

      if (styles.display === "none" || styles.visibility === "hidden") {
        return false;
      }

      current = current.parentElement;
    }

    return true;
  });
}

function rememberBackgroundState(element: HTMLElement) {
  if (!backgroundStates.has(element)) {
    backgroundStates.set(element, {
      ariaHidden: element.getAttribute("aria-hidden"),
      inert: Boolean(element.inert),
    });
  }
}

function syncBackgroundIsolation() {
  const activeHost = activeOverlayHost();

  if (!activeHost) {
    for (const [element, state] of backgroundStates) {
      element.inert = state.inert;

      if (state.ariaHidden == null) {
        element.removeAttribute("aria-hidden");
      } else {
        element.setAttribute("aria-hidden", state.ariaHidden);
      }
    }

    backgroundStates.clear();
    isolationObserver?.disconnect();
    isolationObserver = null;
    document.body.style.overflow = previousBodyOverflow;
    document.body.style.paddingRight = previousBodyPaddingRight;
    return;
  }

  for (const child of document.body.children) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }

    rememberBackgroundState(child);
    const isOverlayPortal = child.id === overlayPortalId;

    child.inert = !isOverlayPortal;

    if (isOverlayPortal) {
      child.removeAttribute("aria-hidden");
    } else {
      child.setAttribute("aria-hidden", "true");
    }
  }

  const portalRoot = document.getElementById(overlayPortalId);

  for (const child of portalRoot?.children ?? []) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }

    rememberBackgroundState(child);
    const isActiveOverlay = child === activeHost;

    child.inert = !isActiveOverlay;

    if (isActiveOverlay) {
      child.removeAttribute("aria-hidden");
    } else {
      child.setAttribute("aria-hidden", "true");
    }
  }
}

function activeOverlayHost() {
  return overlayHosts.reduce<OverlayRegistration | null>((active, candidate) => {
    if (!active) {
      return candidate;
    }

    if (candidate.priority !== active.priority) {
      return candidate.priority > active.priority ? candidate : active;
    }

    if (candidate.depth !== active.depth) {
      return candidate.depth > active.depth ? candidate : active;
    }

    return candidate.order > active.order ? candidate : active;
  }, null)?.host;
}

function registerOverlayHost(
  host: HTMLElement,
  depth: number,
  priority: number,
) {
  if (overlayHosts.length === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousBodyPaddingRight = document.body.style.paddingRight;

    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    isolationObserver = new MutationObserver(() => {
      syncBackgroundIsolation();
    });
    isolationObserver.observe(document.body, { childList: true, subtree: true });
  }

  overlayOrder += 1;
  overlayHosts.push({ depth, host, order: overlayOrder, priority });
  syncBackgroundIsolation();
}

function unregisterOverlayHost(host: HTMLElement) {
  const hostIndex = overlayHosts.findIndex(
    (registration) => registration.host === host,
  );

  if (hostIndex !== -1) {
    overlayHosts.splice(hostIndex, 1);
  }

  syncBackgroundIsolation();
}

function isTopOverlay(host: HTMLElement) {
  return activeOverlayHost() === host;
}

function focusOverlay(
  container: HTMLElement,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const preferred = initialFocusRef?.current;

  if (
    preferred &&
    container.contains(preferred) &&
    visibleFocusableElements(container).includes(preferred)
  ) {
    preferred.focus();
    return;
  }

  const firstFocusable = visibleFocusableElements(container)[0];

  if (firstFocusable) {
    firstFocusable.focus();
  } else {
    container.focus();
  }
}

export function AccessibleOverlay({
  children,
  className = "bg-black/70 backdrop-blur-sm",
  description,
  initialFocusRef,
  label,
  onClose,
  priority = 0,
}: {
  children: ReactNode;
  className?: string;
  description: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  label: string;
  onClose: () => void;
  priority?: number;
}) {
  const depth = useContext(OverlayDepthContext);
  const isClient = useSyncExternalStore(
    subscribeToClientRuntime,
    () => true,
    () => false,
  );
  const portalRoot = isClient
    ? document.getElementById(overlayPortalId)
    : null;
  const dialogRef = useRef<HTMLDivElement>(null);
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const currentDialog = dialogRef.current;

    if (!portalRoot || !currentDialog) {
      return;
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    registerOverlayHost(currentDialog, depth, priority);

    return () => {
      const restoreTarget = restoreFocusRef.current;

      unregisterOverlayHost(currentDialog);

      window.requestAnimationFrame(() => {
        const activeHost = activeOverlayHost();

        if (activeHost) {
          if (
            restoreTarget?.isConnected &&
            activeHost.contains(restoreTarget) &&
            !restoreTarget.inert
          ) {
            restoreTarget.focus();
          } else {
            focusOverlay(activeHost);
          }
          return;
        }

        if (restoreTarget?.isConnected && !restoreTarget.inert) {
          restoreTarget.focus();
        }
      });
    };
  }, [depth, portalRoot, priority]);

  useEffect(() => {
    const currentDialog = dialogRef.current;

    if (!portalRoot || !currentDialog) {
      return;
    }
    const activeDialog: HTMLDivElement = currentDialog;

    if (isTopOverlay(activeDialog)) {
      focusOverlay(activeDialog, initialFocusRef);
    }

    const focusFrame = window.requestAnimationFrame(() => {
      if (
        isTopOverlay(activeDialog) &&
        !activeDialog.contains(document.activeElement)
      ) {
        focusOverlay(activeDialog, initialFocusRef);
      }
    });

    function onKeyDown(event: KeyboardEvent) {
      if (!isTopOverlay(activeDialog)) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = visibleFocusableElements(activeDialog);

      if (focusableElements.length === 0) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements.at(-1) ?? first;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !activeDialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !activeDialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    function containFocus(event: FocusEvent) {
      if (
        isTopOverlay(activeDialog) &&
        event.target instanceof Node &&
        !activeDialog.contains(event.target)
      ) {
        focusOverlay(activeDialog, initialFocusRef);
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", containFocus, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", containFocus, true);
    };
  }, [portalRoot, initialFocusRef]);

  if (!portalRoot) {
    return null;
  }

  return createPortal(
    <OverlayDepthContext.Provider value={depth + 1}>
      <div
        aria-describedby={descriptionId}
        aria-label={label}
        aria-modal="true"
        autoFocus
        className={`fixed inset-0 ${className}`}
        data-alpha-dog-overlay-root=""
        ref={dialogRef}
        role="dialog"
        style={{ zIndex: 50 + depth * 10 + priority }}
        tabIndex={-1}
      >
        <p className="sr-only" id={descriptionId}>
          {description}
        </p>
        <button
          aria-hidden="true"
          className="absolute inset-0 cursor-default"
          onClick={() => {
            const currentDialog = dialogRef.current;

            if (currentDialog && isTopOverlay(currentDialog)) {
              onCloseRef.current();
            }
          }}
          tabIndex={-1}
          type="button"
        />
        {children}
      </div>
    </OverlayDepthContext.Provider>,
    portalRoot,
  );
}
