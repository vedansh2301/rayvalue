/**
 * Supersede-safe async runs: starting a new run (or cancelling) invalidates the previous one
 * and aborts its signal, so a stale result can never be committed.
 */
export interface RunTicket {
  signal: AbortSignal;
  /** True while this is still the latest run and it has not been cancelled. */
  isCurrent(): boolean;
}

export interface RunGuard {
  start(): RunTicket;
  cancel(): void;
}

export function createRunGuard(): RunGuard {
  let current: AbortController | null = null;
  const cancel = () => {
    current?.abort();
    current = null;
  };
  return {
    start() {
      cancel();
      const controller = new AbortController();
      current = controller;
      return { signal: controller.signal, isCurrent: () => current === controller };
    },
    cancel,
  };
}
