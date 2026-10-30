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
    credentials: "same-origin",
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
  if (!sessionToken || !validSessionLocally(sessionToken)) {
    throw new Error("The proxy session is not ready. Reload and try again.");
  }

  // Configure BareMux before registering/activating the service worker.
  // Otherwise the first intercepted request can race ahead without a transport.
  connection = new BareMux.BareMuxConnection("/baremux/worker.js");
  // Keep the Wisp endpoint canonical: libcurl requires the URL to end in "/".
  // The short-lived session is sent separately as a scoped HttpOnly cookie.
  const wispUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/wisp/";
  await connection.setTransport("/libcurl/index.mjs", [{ wisp: wispUrl }]);

  const { ScramjetController } = $scramjetLoadController();
  scramjet = new ScramjetController({
    files: {
      wasm: "/scram/scramjet.wasm.wasm",
      all: "/scram/scramjet.all.js",
      sync: "/scram/scramjet.sync.js"
    }
  });
  await scramjet.init();
  // Initialize Scramjet's IndexedDB schema before the worker can intercept requests.
  await registerSW();
}

async function openTarget(raw) {
  if (!sessionToken || !validSessionLocally(sessionToken)) {
    sessionToken = null;
    throw new Error("Your proxy session expired. Reload the browser to reconnect.");
  }
  const target = normalizeTarget(raw);
  status.textContent = "Starting secure proxy…";
  await initializeScramjet();
  status.textContent = "Building browser tab…";
  frameHost.replaceChildren();
  document.getElementById("start-page")?.classList.add("hidden");
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

if (!embedded) {
  (async () => {
    status.textContent = "Starting ZUX OS…";
    try {
      await unlock("");
      await initializeScramjet();
      login.classList.add("hidden");
      browser.classList.remove("hidden");
      status.textContent = "Ready. Enter a website above.";
    } catch (error) {
      const recovered = await handleStorageFailure(error).catch(() => false);
      if (!recovered) {
        loginError.textContent = error?.message || "Could not start the browser.";
        status.textContent = error?.message || "Could not start the browser.";
      }
    }
  })();
}

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


/* Intro shortcut and always-proxied workspace navigation */
(() => {
 const intro=document.getElementById("intro");let count=0,timer;
 const dismiss=()=>{intro?.classList.add("dismissed");sessionStorage.setItem("zux-intro-seen","1")};
 if(sessionStorage.getItem("zux-intro-seen")==="1")dismiss();
 document.getElementById("intro-continue")?.addEventListener("click",dismiss);
 document.addEventListener("keydown",e=>{if(e.key!=="Enter"||!intro||intro.classList.contains("dismissed"))return;e.preventDefault();count++;clearTimeout(timer);if(count>=2)dismiss();else timer=setTimeout(()=>count=0,1800)});
 const pages=["home","history","games","apps","settings"];
 const show=name=>{pages.forEach(p=>document.getElementById(p==="home"?"start-page":p+"-page")?.classList.toggle("hidden",p!==name));document.querySelectorAll(".side-link").forEach(b=>b.classList.toggle("active",b.dataset.page===name))};
 document.querySelectorAll(".side-link[data-page]").forEach(b=>b.addEventListener("click",()=>show(b.dataset.page)));
 document.querySelectorAll("[data-target]").forEach(b=>b.addEventListener("click",()=>{addressInput.value=b.dataset.target;show("home");browseForm.requestSubmit()}));
 const key="zux-history",read=()=>{try{return JSON.parse(localStorage.getItem(key)||"[]")}catch{return[]}};
 const render=()=>{const el=document.getElementById("history-list");if(!el)return;el.replaceChildren();const a=read();if(!a.length){el.textContent="Your history is empty";return}a.forEach(url=>{const b=document.createElement("button");b.className="history-entry";b.textContent=url;b.onclick=()=>{addressInput.value=url;show("home");browseForm.requestSubmit()};el.appendChild(b)})};
 document.querySelector('[data-page="history"]')?.addEventListener("click",render);
 document.getElementById("clear-history")?.addEventListener("click",()=>{localStorage.removeItem(key);render()});
 const original=openTarget;openTarget=async raw=>{const target=await original(raw);localStorage.setItem(key,JSON.stringify([target,...read().filter(x=>x!==target)].slice(0,50)));render();return target};
})();
