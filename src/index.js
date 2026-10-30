import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createHmac, timingSafeEqual } from "node:crypto";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));
const port = Number.parseInt(process.env.PORT || "10000", 10);
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("A 32+ character SESSION_SECRET must be configured.");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT.");

logging.set_level(logging.WARN);
Object.assign(wisp.options, {
  allow_tcp_streams: true,
  allow_udp_streams: true,
  allow_private_ips: false,
  allow_loopback_ips: false,
  allow_direct_ip: false,
  stream_limit_total: 128,
  stream_limit_per_host: 32,
  dns_method: "resolve",
  dns_servers: ["1.1.1.1", "1.0.0.1"],
  dns_result_order: "ipv4first",
  dns_ttl: 300
});

const sign = (payload) => createHmac("sha256", sessionSecret).update(payload).digest();
function issueSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 4 * 60 * 60 * 1000 })).toString("base64url");
  return payload + "." + sign(payload).toString("base64url");
}
function validSession(token) {
  if (typeof token !== "string" || token.length > 1024) return false;
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra) return false;
  const expected = sign(payload).toString("base64url");
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number.isFinite(decoded.exp) && decoded.exp > Date.now();
  } catch { return false; }
}
const failedLogins = new Map();
const fastify = Fastify({
  logger: { level: "warn" },
  trustProxy: true,
  bodyLimit: 2048,
  serverFactory: (handler) => createServer()
    .on("request", (req, res) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      handler(req, res);
    })
    .on("upgrade", (req, socket, head) => {
      let pathname = "/";
      let token = "";
      try {
        const parsed = new URL(req.url || "/", "http://localhost");
        pathname = parsed.pathname;
        const cookieHeader = req.headers.cookie || "";
        const sessionCookie = cookieHeader.match(/(?:^|;\s*)zux_proxy_session=([^;]+)/);
        token = sessionCookie ? decodeURIComponent(sessionCookie[1]) : "";
      } catch { socket.destroy(); return; }
      if (pathname !== "/wisp/" || !validSession(token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      req.url = pathname;
      wisp.routeRequest(req, socket, head);
    })
});
fastify.get("/api/health", async () => ({ ok: true, service: "private-browser-scramjet" }));
fastify.post("/api/session", async (request, reply) => {
  // The browser sends this HttpOnly cookie only to /wisp/. Keeping credentials
  // out of the WebSocket URL also preserves the trailing slash required by Wisp.
  const token = issueSession();
  const secure = request.headers["x-forwarded-proto"] === "https" || request.protocol === "https";
  const cookie = [
    "zux_proxy_session=" + encodeURIComponent(token),
    "Path=/wisp/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=14400",
    ...(secure ? ["Secure"] : [])
  ].join("; ");
  return reply.header("Set-Cookie", cookie).send({ token, expiresIn: 4 * 60 * 60 });
});

await fastify.register(fastifyStatic, { root: publicPath, decorateReply: true, index: ["index.html"] });
await fastify.register(fastifyStatic, { root: scramjetPath, prefix: "/scram/", decorateReply: false });
await fastify.register(fastifyStatic, { root: libcurlPath, prefix: "/libcurl/", decorateReply: false });
await fastify.register(fastifyStatic, { root: baremuxPath, prefix: "/baremux/", decorateReply: false });
fastify.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
  return reply.code(404).type("text/plain").send("Not found");
});
await fastify.listen({ port, host: "0.0.0.0" });
console.log("Private Browser Scramjet is listening.");
