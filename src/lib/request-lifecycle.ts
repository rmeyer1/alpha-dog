export interface RequestToken {
  id: number;
  signal: AbortSignal;
}

export class LatestRequestLifecycle {
  private active:
    | {
        controller: AbortController;
        id: number;
      }
    | undefined;
  private nextId = 0;

  begin(): RequestToken {
    this.active?.controller.abort();

    const controller = new AbortController();
    const id = ++this.nextId;
    this.active = { controller, id };

    return {
      id,
      signal: controller.signal,
    };
  }

  isActive(token: RequestToken): boolean {
    return this.active?.id === token.id &&
      this.active.controller.signal === token.signal;
  }

  commit(token: RequestToken, action: () => void): boolean {
    if (!this.isActive(token)) {
      return false;
    }

    action();
    return true;
  }

  finish(token: RequestToken): boolean {
    if (!this.isActive(token)) {
      return false;
    }

    this.active = undefined;
    return true;
  }

  abort(): void {
    this.active?.controller.abort();
    this.active = undefined;
  }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError";
}
