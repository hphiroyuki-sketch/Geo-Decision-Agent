/**
 * PWA registration (5.1 / NFR-015).
 *
 * Three obligations from the requirements, and nothing beyond them:
 *   ホーム追加   - the manifest does this once the worker is controlling.
 *   更新通知     - onUpdate fires when a new build is waiting.
 *   端末データ消去 - clearDeviceData() on sign-out.
 */

let waitingWorker: ServiceWorker | null = null;

export function registerServiceWorker(onUpdate: () => void): void {
  if (!("serviceWorker" in navigator)) return;
  // Vite's dev server serves modules the shell cache would fight with.
  if (import.meta.env.DEV) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (reg.waiting) {
          waitingWorker = reg.waiting;
          onUpdate();
        }
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // A worker that reaches "installed" while one is already in control
            // is a new build sitting behind the current page.
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              waitingWorker = installing;
              onUpdate();
            }
          });
        });
      })
      .catch(() => {
        /* an app that works without the worker is the acceptable outcome */
      });
  });
}

/** Activates the waiting build and reloads onto it. */
export function applyUpdate(): void {
  if (!waitingWorker) {
    window.location.reload();
    return;
  }
  waitingWorker.postMessage("SKIP_WAITING");
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
}

/** Drops every cache and stored preference this origin holds on the device. */
export async function clearDeviceData(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage("CLEAR_CACHES");
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* nothing stored, or storage blocked - both are fine */
  }
}
