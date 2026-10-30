importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

async function handleRequest(event) {
  const url = new URL(event.request.url);
  // Do not open Scramjet's database for ordinary site assets. The page
  // creates the complete v1 schema before this worker is registered.
  if (url.pathname.startsWith("/scramjet/") || url.pathname === "/scramjet.wasm.wasm") {
    await scramjet.loadConfig();
    if (scramjet.route(event)) return scramjet.fetch(event);
  }
  return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
