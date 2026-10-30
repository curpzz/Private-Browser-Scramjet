"use strict";
const login = document.getElementById("login");
const browser = document.getElementById("browser");
const loginForm = document.getElementById("login-form");
const pinInput = document.getElementById("pin");
const loginError = document.getElementById("login-error");
const browseForm = document.getElementById("browse-form");
const addressInput = document.getElementById("address");
const status = document.getElementById("status");
const frameHost = document.getElementById("frame-host");
const embedded = new URLSearchParams(location.search).get("embed") === "1";
const parentOrigin = "https://schools-math.higgsfield.app";
let sessionToken = null;
let scramjet = null;
let connection = null;

function notifyParent(type, extra = {}) {
  if (embedded && window.parent !== window) {
    window.parent.postMessage({ type, ...extra }, parentOrigin);
  }
}

function normalizeTarget(value) {
  const input = value.trim();
  if (!input) throw new Error("Enter a website or search term.");
  if (/^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}([/:?#]|$)/i.test(input)) {
    return new URL(/^https?:\/\//i.test(input) ? input : "https://" + input).href;
  }
  return "https://www.google.com/search?q=" + encodeURIComponent(input);
}

async function unlock(pin) {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) throw new Error(data.error || "Unable to unlock browser.");
  sessionToken = data.token;
}

async function recoverIndexedDBState() {
  // Clear only this site's local proxy databases and worker caches.
  try {
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      await Promise.all(databases.filter((db) => db.name).map((db) =>
        new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(db.name);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        })
      ));
    }
  } catch (error) {
    console.warn("Could not enumerate local databases:", error);
  }
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch (error) {
    console.warn("Could not reset service workers:", error);
  }
  try {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  } catch (error) {
    console.warn("Could not clear local worker caches:", error);
  }
}

async function handleStorageFailure(error) {
  const message = String(error?.message || error || "");
  if (!/object store|IDBDatabase|IndexedDB/i.test(message)) return false;
  const key = "zux-idb-recovery-attempted";
  if (sessionStorage.getItem(key) === "1") return false;
  sessionStorage.setItem(key, "1");
  loginError.textContent = "Repairing browser storage… this page will reload.";
  await recoverIndexedDBState();
  location.reload();
  return true;
}

async function initializeScramjet() {
  if (scramjet) return;
  await registerSW();
  const { ScramjetController } = $scramjetLoadController();
  scramjet = new ScramjetController({
    files: {
      wasm: "/scram/scramjet.wasm.wasm",
      all: "/scram/scramjet.all.js",
      sync: "/scram/scramjet.sync.js"
    }
  });
  await scramjet.init();
  connection = new BareMux.BareMuxConnection("/baremux/worker.js");
}

async function openTarget(raw) {
  if (!sessionToken || !validSessionLocally(sessionToken)) {
    sessionToken = null;
    throw new Error("Your proxy session expired. Enter the access code again.");
  }
  const target = normalizeTarget(raw);
  await initializeScramjet();
  const wispUrl = "wss://" + location.host + "/wisp/?token=" + encodeURIComponent(sessionToken);
  await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
  frameHost.replaceChildren();
  const frame = scramjet.createFrame();
  frame.frame.id = "proxy-frame";
  frame.frame.title = "Scramjet website view";
  frameHost.appendChild(frame.frame);
  frame.go(target);
  status.textContent = "Opening " + new URL(target).hostname + " through Scramjet…";
  return target;
}

function validSessionLocally(token) {
  try {
    const payload = token.split(".")[0];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return Number.isFinite(decoded.exp) && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

if (embedded) {
  document.body.classList.add("embed-mode");
  login.classList.add("hidden");
  browser.classList.remove("hidden");
  status.textContent = "Waiting for secure proxy handoff…";
  window.addEventListener("message", async (event) => {
    if (event.origin !== parentOrigin || event.source !== window.parent) return;
    const message = event.data;
    if (!message || typeof message !== "object") return;

    if (message.type === "private-browser:unlock") {
      try {
        if (!sessionToken) await unlock(message.pin);
        await initializeScramjet();
        const target = await openTarget(message.target);
        notifyParent("private-browser:ready", { hostname: new URL(target).hostname });
      } catch (error) {
        notifyParent("private-browser:error", { message: error?.message || "Could not start Scramjet." });
      }
      return;
    }

    if (message.type === "private-browser:navigate") {
      try {
        const target = await openTarget(message.target);
        notifyParent("private-browser:page-loaded", { hostname: new URL(target).hostname });
      } catch (error) {
        notifyParent("private-browser:error", { message: error?.message || "Could not open that website." });
      }
      return;
    }

    if (message.type === "private-browser:lock") {
      sessionToken = null;
      frameHost.replaceChildren();
      status.textContent = "Proxy locked.";
      notifyParent("private-browser:locked");
    }
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const button = loginForm.querySelector("button");
  button.disabled = true;
  try {
    await unlock(pinInput.value);
    pinInput.value = "";
    await initializeScramjet();
    login.classList.add("hidden");
    browser.classList.remove("hidden");
    status.textContent = "Session ready. Enter a website above.";
  } catch (error) {
    const recovered = await handleStorageFailure(error).catch(() => false);
    if (!recovered) {
      loginError.textContent = error?.message || "Could not unlock browser.";
    }
  } finally {
    button.disabled = false;
  }
});

browseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Preparing connection…";
  try {
    if (!sessionToken) throw new Error("Unlock the browser first.");
    await openTarget(addressInput.value);
  } catch (error) {
    status.textContent = error?.message || "Could not open that site.";
  }
});

document.getElementById("lock").addEventListener("click", () => {
  sessionToken = null;
  frameHost.replaceChildren();
  browser.classList.add("hidden");
  login.classList.remove("hidden");
  notifyParent("private-browser:locked");
});
