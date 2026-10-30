importScripts("/scram/scramjet.all.js");
const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
async function handleRequest(event) {
  await scramjet.loadConfig();
  return scramjet.route(event) ? scramjet.fetch(event) : fetch(event.request);
}
self.addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));
