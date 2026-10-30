"use strict";
async function registerSW() {
  if (!("serviceWorker" in navigator)) throw new Error("This browser does not support service workers.");
  if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) {
    throw new Error("Secure HTTPS is required for the proxy service worker.");
  }
  const registration = await navigator.serviceWorker.register("/sw.js?v=20261030-3", {
    scope: "/",
    updateViaCache: "none"
  });
  await registration.update();
  await navigator.serviceWorker.ready;
}
