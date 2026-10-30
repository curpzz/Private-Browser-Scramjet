importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

function deleteDatabase(name) {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

async function clearStaleProxyDatabases() {
  // This origin is dedicated to the proxy; clear stale schemas left by older builds.
  if (typeof indexedDB.databases !== "function") return;
  const databases = await indexedDB.databases();
  await Promise.all(databases.filter((database) => database.name).map((database) => deleteDatabase(database.name)));
}

let configPromise;
function loadConfigOnce() {
  if (!configPromise) {
    configPromise = scramjet.loadConfig().catch(async (error) => {
      if (error?.name !== "NotFoundError") throw error;
      configPromise = null;
      await clearStaleProxyDatabases();
      configPromise = scramjet.loadConfig();
      return configPromise;
    });
  }
  return configPromise;
}

async function handleRequest(event) {
  await loadConfigOnce();
  return scramjet.route(event) ? scramjet.fetch(event) : fetch(event.request);
}

self.addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await clearStaleProxyDatabases();
    configPromise = null;
    await self.clients.claim();
  })());
});
