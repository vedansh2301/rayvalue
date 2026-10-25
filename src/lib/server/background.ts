/**
 * Run work after the response is sent. On Vercel the platform exposes waitUntil through a request-context symbol
 * (the mechanism @vercel/functions uses); elsewhere (tests, `astro dev`) the promise is simply awaited so work is
 * never silently dropped. Errors are logged by name only.
 */
const CONTEXT = Symbol.for('@vercel/request-context');

export async function runInBackground(work: () => Promise<unknown>): Promise<void> {
  const p = work().catch((e) => {
    console.error('background task failed', e instanceof Error ? e.name : 'error');
  });
  const ctx = (globalThis as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } } | undefined>)[CONTEXT]?.get?.();
  if (ctx?.waitUntil) {
    ctx.waitUntil(p);
    return;
  }
  await p;
}
