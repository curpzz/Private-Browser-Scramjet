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
let sessionToken = null;
let scramjet = null;
let connection = null;

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
    loginError.textContent = error?.message || "Could not unlock browser.";
  } finally {
    button.disabled = false;
  }
});
browseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Preparing connection…";
  try {
    if (!sessionToken) throw new Error("Unlock the browser first.");
    const target = normalizeTarget(addressInput.value);
    await initializeScramjet();
    const wispUrl = "wss://" + location.host + "/wisp/?token=" + encodeURIComponent(sessionToken);
    await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
    frameHost.replaceChildren();
    const frame = scramjet.createFrame();
    frame.frame.id = "proxy-frame";
    frameHost.appendChild(frame.frame);
    frame.go(target);
    status.textContent = "Opening " + new URL(target).hostname + "…";
  } catch (error) {
    status.textContent = error?.message || "Could not open that site.";
  }
});
document.getElementById("lock").addEventListener("click", () => {
  sessionToken = null;
  frameHost.replaceChildren();
  browser.classList.add("hidden");
  login.classList.remove("hidden");
});
