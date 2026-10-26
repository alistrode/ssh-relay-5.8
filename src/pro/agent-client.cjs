"use strict";
const http = require("node:http"),
  path = require("node:path"),
  fs = require("node:fs"),
  os = require("node:os"),
  cp = require("node:child_process"),
  { folder, read } = require("./store.cjs");
function request(dir, route, body, options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof route !== "string" || !route.startsWith("/") || route.startsWith("//") ||
        /[\r\n]/.test(route)) {
      reject(Error("Invalid Agent request route"));
      return;
    }
    if (options.timeoutMs !== undefined &&
        (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 120000)) {
      reject(Error("Invalid Agent request timeout"));
      return;
    }
    let runtime;
    try {
      runtime = read(path.join(dir, "agent-runtime.json"));
      if (!runtime) throw Error("Agent is not running");
      if (!Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535 ||
          !/^[a-f0-9]{64}$/.test(runtime.token))
        throw Error("Invalid local Agent endpoint");
    } catch (e) {
      reject(e instanceof SyntaxError
        ? Object.assign(Error("Invalid local Agent runtime"), { code: "LOCAL_STATE_INVALID" }) : e);
      return;
    }
    const r = http.request(
      {
        host: "127.0.0.1",
        port: runtime.port,
        path: route,
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: "Bearer " + runtime.token,
          "Content-Type": "application/json",
        },
        timeout: options.timeoutMs ?? 110000,
        signal: options.signal,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("error", reject);
        res.on("aborted", () => reject(Error("Agent response interrupted")));
        res.on("data", (b) => {
          size += b.length;
          if (size > 2 * 1024 * 1024)
            r.destroy(Error("Agent response too large"));
          else chunks.push(b);
        });
        res.on("end", () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(value);
            else {
              const detail = value.error;
              const error = Error(typeof detail === "string" ? detail : detail?.message || "Agent request failed");
              error.statusCode = res.statusCode;
              error.code = detail?.code;
              error.phase = detail?.phase;
              error.retryable = detail?.retryable;
              error.details = detail?.details;
              error.recovery = value.recovery;
              error.connectionTaskId = value.connectionTaskId;
              reject(error);
            }
          } catch (e) {
            reject(e instanceof SyntaxError ? Error("Agent returned invalid JSON") : e);
          }
        });
      },
    );
    r.on("error", reject);
    const deadline = setTimeout(() => r.destroy(Error("Agent request timeout")), options.timeoutMs ?? 110000);
    deadline.unref();
    r.once("close", () => clearTimeout(deadline));
    r.on("timeout", () => r.destroy(Error("Agent request timeout")));
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const starting = new Map();
const readiness = new Map();
function stateDirectory({ dir, profileDir, role = "near" } = {}) {
  if (!["near", "far"].includes(role)) throw Error("Invalid role");
  if (dir && profileDir) throw Error("Use state dir or profile dir, not both");
  return path.resolve(dir || path.join(profileDir || path.join(os.homedir(), ".ssh-relay-pro-5.5"), role));
}
async function health(dir, role) {
  const value = await request(dir, "/v55/health", undefined, { timeoutMs: 2000 });
  const runtime = read(path.join(dir, "agent-runtime.json"));
  const identity = read(path.join(dir, "identity.json"));
  if (value.apiVersion !== 55 || value.role !== role ||
      value.profileId !== identity?.deviceId ||
      value.profileId !== runtime?.profileId ||
      value.bootId !== runtime?.bootId || runtime?.role !== role) {
    const error = Error("Agent API, role or profile identity mismatch");
    error.code = "AGENT_IDENTITY_MISMATCH";
    throw error;
  }
  return value;
}
async function startAgent(options, dir) {
  const role = options.role || "near";
  const check = async () => {
    try { await health(dir, role); return true; }
    catch (error) {
      // Never start another service over a responding, incompatible endpoint.
      if (error.statusCode || error.code === "AGENT_IDENTITY_MISMATCH") throw error;
      if (!["ECONNREFUSED", "ECONNRESET", "ENOENT"].includes(error.code) &&
          !["Agent is not running", "Agent request timeout"].includes(error.message)) throw error;
      return false;
    }
  };
  if (await check()) return;
  await require("./client-lifecycle.cjs").requireClient(dir);
  folder(dir);
  const fd = fs.openSync(path.join(dir, "bootstrap.log"), "a", 0o600);
  try {
    const child = cp.spawn(process.execPath, [
      path.join(__dirname, "guardian.cjs"), "--state-dir", dir, "--role", role,
      ...(options.allowCloudSelfTest ? ["--allow-cloud-self-test"] : []),
    ], {
      stdio: ["ignore", fd, fd], detached: true, windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SSH_RELAY_CLIENT_PROFILE: require("./client-lifecycle.cjs").profileFor(dir) },
    });
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });
    child.unref();
  } finally { fs.closeSync(fd); }
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (await check()) return;
  }
  throw Error("Agent could not start; inspect the private bootstrap.log");
}
async function ensureAgent(options = {}) {
  const dir = stateDirectory(options), role = options.role || "near";
  await require("./client-lifecycle.cjs").requireClient(dir);
  const key = role + ":" + dir;
  if (!starting.has(key)) {
    const task = startAgent(options, dir).finally(() => starting.delete(key));
    starting.set(key, task);
  }
  await starting.get(key);
  const client = {
    request: (method, route, body, requestOptions) => {
      if (!["GET", "POST"].includes(method) || (method === "GET" && body !== undefined) ||
          (method === "POST" && body === undefined))
        throw Error("Invalid Agent request method/body");
      return request(dir, route, body, requestOptions);
    },
  };
  client.devices = () => client.request("GET", "/v55/devices");
  const { observeConnectionRequest } = require("./connection-status.cjs");
  const currentDevices = () => client.request("GET", "/v55/devices", undefined, { timeoutMs: 2000 });
  client.connect = async (input) => observeConnectionRequest(
    await client.request("POST", "/v55/connections", input, { timeoutMs: 25000 }), currentDevices);
  client.connectionTask = async (key) => observeConnectionRequest(
    await client.request("GET", "/v55/connections/" + encodeURIComponent(key)), currentDevices,
    { statusQuery: true });
  client.getConnection = (deviceId) => client.request("GET", "/v55/devices/" + encodeURIComponent(deviceId) + "/connection");
  client.disconnect = (deviceId, requestId) => client.request("POST",
    "/v55/devices/" + encodeURIComponent(deviceId) + "/disconnect", { requestId });
  client.workflowStage = (key, input) => client.request("POST", "/v55/operations/" + encodeURIComponent(key) + "/stage", input);
  client.registerOperation = (input) => client.request("POST", "/v55/operations", input);
  client.registerSession = input => client.request("POST", "/v55/sessions", input);
  client.sessions = () => client.request("GET", "/v55/sessions");
  client.session = (id, params = {}) => client.request("GET", "/v55/sessions/" + encodeURIComponent(id) + "?" + new URLSearchParams(params));
  client.registerSessionRequest = (id, input) => client.request("POST", "/v55/sessions/" + encodeURIComponent(id) + "/requests", input);
  client.sessionRequests = id => client.request("GET", "/v55/sessions/" + encodeURIComponent(id) + "/requests");
  client.markOperationDispatch = (key) => client.request("POST", "/v55/operations/" + encodeURIComponent(key) + "/dispatch", {});
  client.operationNotStarted = (key) => client.request("POST", "/v55/operations/" + encodeURIComponent(key) + "/not-started", {});
  client.operations = (params = {}) => client.request("GET", "/v55/operations?" + new URLSearchParams(params));
  client.operation = (key, params = {}) => client.request("GET",
    "/v55/operations/" + encodeURIComponent(key) + "?" + new URLSearchParams(params));
  client.cancelOperation = (key, requestId) => client.request("POST",
    "/v55/operations/" + encodeURIComponent(key) + "/cancel", { requestId });
  client.ensureReady = async (deviceId) => {
    const key = dir + ":" + deviceId;
    if (readiness.has(key)) return readiness.get(key);
    const pending = (async () => {
    try { return await client.getConnection(deviceId); }
    catch (error) {
      if (!["DEVICE_NOT_READY", "WAITING_APPROVAL"].includes(error.code)) throw error;
    }
    let task = await client.connect({ requestId: require("node:crypto").randomUUID(), deviceId, waitMs: 20000 });
    if (task.state !== "ready") {
      const error = Error(task.error?.message || "Device connection is " + task.state);
      error.code = task.error?.code || (task.state === "waiting_approval" ? "WAITING_APPROVAL" : "DEVICE_NOT_READY");
      error.connectionTaskId = task.connectionTaskId;
      error.retryable = task.error?.retryable ?? true;
      throw error;
    }
      return client.getConnection(deviceId);
    })();
    readiness.set(key, pending);
    try { return await pending; }
    finally { if (readiness.get(key) === pending) readiness.delete(key); }
  };
  return client;
}
// Current 5.5 CLI API.
async function ensure(options) { await ensureAgent(options); }
module.exports = { request, ensure, ensureAgent, stateDirectory };

