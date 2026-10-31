"use strict";
async function registerSW() {
  if (!("serviceWorker" in navigator)) throw new Error("This browser does not support service workers.");
  if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) {
    throw new Error("Secure HTTPS is required for the proxy service worker.");
  }

  const registration = await navigator.serviceWorker.register("/sw.js?v=20261031-auto-unlock-3", {
    scope: "/",
    updateViaCache: "none"
  });
  await registration.update();

  // Scramjet must talk to the active service worker. "ready" alone does not
  // guarantee this page is controlled (especially on the first visit).
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("The proxy service worker did not take control. Reload this page and try again."));
      }, 15000);
      const onController = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener("controllerchange", onController);
      };
      navigator.serviceWorker.addEventListener("controllerchange", onController, { once: true });
      if (navigator.serviceWorker.controller) onController();
    });
  }
  if (!navigator.serviceWorker.controller) {
    throw new Error("The proxy service worker is not controlling this tab. Reload and try again.");
  }
  return registration;
}
