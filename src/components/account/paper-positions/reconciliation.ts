import type {
  PositionEvent,
  PositionPage,
  PositionSummary,
  PositionTab,
  PositionsPayload,
} from "./contracts";

/** Keeps pagination retries idempotent and moves state-transitioned rows between tabs. */
export function mergePositionRows(
  current: PositionSummary[],
  incoming: PositionSummary[],
) {
  const rows = new Map(current.map((position) => [position.id, position]));
  for (const position of incoming) rows.set(position.id, position);
  return [...rows.values()];
}

export function reconcilePositionPages(
  pages: PositionsPayload["pages"],
  scope: PositionTab,
  incoming: PositionPage,
) {
  const otherScope = scope === "open" ? "history" : "open";
  const incomingIds = new Set(incoming.items.map((position) => position.id));
  return {
    ...pages,
    [otherScope]: {
      ...pages[otherScope],
      items: pages[otherScope].items.filter(
        (position) => !incomingIds.has(position.id),
      ),
    },
    [scope]: {
      ...incoming,
      items: mergePositionRows(pages[scope].items, incoming.items),
    },
  };
}

export function mergePositionEvents(
  current: PositionEvent[],
  incoming: PositionEvent[],
) {
  const events = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) events.set(event.id, event);
  return [...events.values()];
}
