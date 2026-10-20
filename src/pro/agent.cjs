"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  http = require("node:http"),
  cp = require("node:child_process");
const { Client } = require("ssh2"),
  {
    folder,
    read,
    write,
    text,
    retryDelay,
    ownedProcess,
    systemBootId,
    id,
    broker,
  } = require("./store.cjs"),
  { keyPair } = require("./keys.cjs"),
  pairing = require("./pairing.cjs"),
  { createTraceWriter } = require("../diagnostics.cjs");
const DEFAULT_BROKER = "wss://broker.emqx.io:8084/mqtt";
const { DeviceSlots } = require("./device-slots.cjs");
class Agent {
  constructor({
    role,
    dir,
    brokerUrl = DEFAULT_BROKER,
    allowCloudSelfTest = false,
    testHooks = false,
  }) {
    if (!["near", "far"].includes(role)) throw Error("Invalid role");
    this.role = role;
    this.dir = path.resolve(folder(dir));
    this.broker = broker(brokerUrl);
    this.allowCloudSelfTest = allowCloudSelfTest;
    this.testHooks = testHooks;
    this.targets = new Map();
    this.deviceSlots = new DeviceSlots();
    this.children = new Map();
    this.stats = {
      attempts: 0,
      connected: 0,
      workerRestarts: 0,
      disconnects: 0,
    };
    this.stopping = false;
    this.bootId = crypto.randomUUID();
    this.apiToken = crypto.randomBytes(32).toString("hex");
    this.settings = read(path.join(this.dir, "settings.json"), {
      enabled: true,
      autoConnect: true,
      label: os.hostname(),
      defaultDevice: null,
    });
    this.identity = read(path.join(this.dir, "identity.json"), null) || {
      deviceId: crypto.randomUUID(),
    };
    write(path.join(this.dir, "identity.json"), this.identity);
    write(path.join(this.dir, "settings.json"), this.settings);
    this.logFile = path.join(this.dir, "agent-events.jsonl");
    this.record = createTraceWriter(this.dir, "agent");
  }
  log(event, details = {}) {
    const entry = { event, role: this.role, bootId: this.bootId, ...details };
    this.record(entry);
    this.emit?.(entry);
  }
  file(name) {
    return path.join(this.dir, name);
  }
  async start() {
    const lock = this.file("agent.lock");
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      await new Promise((resolve) => setTimeout(resolve, 100));
      const previous = read(path.join(lock, "owner.json"), {});
      if (
        !Number.isInteger(previous.pid) &&
        Date.now() - fs.statSync(lock).mtimeMs < 5000
      )
        throw Error("This profile is starting another agent");
      const alive = ownedProcess(
        previous.pid,
        this.dir,
        "agent",
        previous.osBoot,
      );
      if (alive) throw Error("This profile already has an agent");
      fs.rmSync(lock, { recursive: true });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      fs.mkdirSync(lock, { mode: 0o700 });
    }
    write(path.join(lock, "owner.json"), {
      pid: process.pid,
      bootId: this.bootId,
      osBoot: systemBootId(),
    });
    this.server = http.createServer((req, res) => this.api(req, res));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    write(this.file("agent-runtime.json"), {
      pid: process.pid,
      port: this.server.address().port,
      token: this.apiToken,
      role: this.role,
      bootId: this.bootId,
    });
    if (this.role === "far") this.initFar();
    this.log("agent_started", { deviceId: this.identity.deviceId });
    this.timer = setInterval(() => this.tick(), 500);
    this.tick();
    return this;
  }
  initFar() {
    const dir = folder(this.file("far"));
    let info = read(path.join(dir, "connection-private.json"), null);
    if (!info) {
      const host = keyPair("relay-pro-host"),
        unused = keyPair("relay-pro-unused");
      info = {
        version: 2,
        target: process.platform === "win32" ? "win10" : "linux",
        broker: this.broker,
        session: crypto.randomBytes(16).toString("hex"),
        secret: crypto.randomBytes(32).toString("hex"),
        user: "relay",
        fingerprint: host.fingerprint,
        hostPublicKey: host.publicKey,
        deviceId: this.identity.deviceId,
        hostname: os.hostname(),
      };
      text(path.join(dir, "host_key"), host.privateKey);
      text(path.join(dir, "client_key.pub"), unused.publicKey + "\n");
      write(path.join(dir, "connection-private.json"), info);
    }
    if (info.deviceId !== this.identity.deviceId)
      throw Error("Far device identity mismatch");
    this.info = info;
    const clients = path.join(dir, "authorized-clients.json");
    if (!fs.existsSync(clients)) write(clients, {});
    write(path.join(dir, "remote.json"), {
      ...info,
      sshPort: 0,
      reconnectPolicy: true,
      testHooks: this.testHooks,
      clientKeysFile: clients,
      connectionAdmission: true,
      clockSkewCorrection: true,
    });
  }
  registry() {
    return read(this.file("devices.json"), {});
  }
  saveRegistry(value) {
    write(this.file("devices.json"), value);
  }
  safeInfo(info) {
    if (
      !info ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(info.fingerprint) ||
      !/^[a-f0-9]{32}$/.test(info.session) ||
      !/^[a-f0-9]{64}$/.test(info.secret) ||
      !["linux", "win10"].includes(info.target) ||
      typeof info.hostPublicKey !== "string" ||
      typeof info.hostname !== "string"
    )
      throw Error("Invalid paired identity");
    id(info.deviceId);
    broker(info.broker);
    const publicBlob = Buffer.from(
      info.hostPublicKey.split(/\s+/)[1] || "",
      "base64",
    );
    const fp =
      "SHA256:" +
      crypto
        .createHash("sha256")
        .update(publicBlob)
        .digest("base64")
        .replace(/=+$/, "");
    if (fp !== info.fingerprint)
      throw Error("Pairing host fingerprint mismatch");
    return info;
  }
  async createPair() {
    if (this.role !== "far")
      throw Error("Only a far end can create a pairing code");
    this.offer?.cancel();
    this.offer = await pairing.offer({
      broker: this.broker,
      info: { ...this.info, label: this.settings.label },
      authorize: async (who) => {
        const file = path.join(this.dir, "far/authorized-clients.json"),
          clients = read(file, {});
        clients[id(who.deviceId)] = {
          publicKey: who.publicKey,
          label: String(who.label || "Near end").slice(0, 80),
          pairedAt: Date.now(),
        };
        write(file, clients);
      },
      log: (event, details) => this.log(event, details),
    });
    this.log("pair_offer_created", { expiresAt: this.offer.expiresAt });
    return { code: this.offer.code, expiresAt: this.offer.expiresAt };
  }
  async joinPair(code) {
    if (this.role !== "near")
      throw Error("Only a near end can enter a pairing code");
    if (this.pairBusy) throw Error("Pairing already in progress");
    this.pairBusy = true;
    try {
      let keys = read(this.file("near-identity-key.json"), null);
      if (!keys) {
        keys = keyPair("relay-pro-near");
        write(this.file("near-identity-key.json"), keys);
      }
      const info = await pairing.join({
        broker: this.broker,
        code,
        who: {
          deviceId: this.identity.deviceId,
          publicKey: keys.publicKey,
          label: this.settings.label,
        },
        accept: async (value) => {
          this.safeInfo(value);
          const registry = this.registry();
          this.deviceSlots.assertCanEnable(registry, value.deviceId);
          const deviceDir = folder(this.file("devices/" + value.deviceId));
          text(path.join(deviceDir, "client_key"), keys.privateKey);
          text(
            path.join(deviceDir, "known_hosts"),
            "relay-" + value.deviceId + " " + value.hostPublicKey + "\n",
          );
          write(path.join(deviceDir, "identity.json"), value);
          registry[value.deviceId] = {
            id: value.deviceId,
            label: value.label || value.hostname,
            hostname: value.hostname,
            target: value.target,
            enabled: true,
            pairedAt: registry[value.deviceId]?.pairedAt || Date.now(),
          };
          this.saveRegistry(registry);
          const existing = this.targets.get(value.deviceId);
          if (existing) {
            existing.client?.destroy();
            existing.client = null;
            existing.state = "waiting";
            existing.failures = 0;
            existing.nextAt = 0;
            this.stopWorker(value.deviceId);
          }
          this.settings.defaultDevice = value.deviceId;
          write(this.file("settings.json"), this.settings);
        },
      });
      this.log("pair_saved", { deviceId: info.deviceId });
      this.tick();
      return { deviceId: info.deviceId };
    } finally {
      this.pairBusy = false;
    }
  }
  spawnWorker(key, script, args, dir) {
    if (this.children.has(key) || this.stopping) return;
    const child = cp.spawn(
      process.execPath,
      [
        path.join(__dirname, "worker.cjs"),
        key === "far" ? "far" : "near",
        args[0],
      ],
      {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      },
    );
    const item = { child, dir, failures: 0 };
    if (key === "far") this.admission = null;
    this.children.set(key, item);
    child.on("message", message => {
      if (key === "far" && this.children.get(key) === item && message?.type === "admission-status") {
        this.admission = message.value;
        this.notifyConsent();
      }
    });
    this.stats.workerRestarts++;
    this.log("worker_started", { worker: key, pid: child.pid });
    const lines = (stream) => {
      let pending = "";
      stream.on("data", (chunk) => {
        pending += chunk.toString();
        if (pending.length > 65536) pending = pending.slice(-32768);
        let i;
        while ((i = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, i);
          pending = pending.slice(i + 1);
          if (line.startsWith("RELAY_TRACE ") || line.startsWith("SSH_TRACE "))
            try {
              const entry = JSON.parse(line.slice(line.indexOf(" ") + 1));
              this.log("worker_trace", { worker: key, trace: entry });
              if (key === "far" && entry.event === "mqtt_subscribed") {
                this.farState = "waiting";
                this.farFailures = 0;
              }
              if (key === "far" && entry.event === "mqtt_offline")
                this.farState = "retrying";
              if (key === "far" && entry.event === "ssh_ready")
                this.farState = "online";
            } catch {}
          else if (line.trim())
            this.log("worker_message", {
              worker: key,
              message: line.startsWith("Authenticated remote status:")
                ? "authenticated peer status"
                : line
                    .replace(
                      /(BUNDLE=).*|-----BEGIN.*PRIVATE KEY.*/g,
                      "[REDACTED]",
                    )
                    .slice(0, 240),
            });
        }
      });
    };
    lines(child.stdout);
    lines(child.stderr);
    child.on("error", (e) =>
      this.log("worker_spawn_error", { worker: key, code: e.code }),
    );
    child.on("close", (code, signal) => {
      this.log("worker_exited", { worker: key, code, signal });
      if (this.children.get(key) !== item) return;
      this.children.delete(key);
      const target = this.targets.get(key);
      if (target) {
        target.client?.destroy();
        target.client = null;
        target.nextAt = Date.now() + retryDelay(++target.workerFailures);
      } else if (key === "far") {
        this.farFailures = (this.farFailures || 0) + 1;
        this.farNextAt = Date.now() + retryDelay(this.farFailures);
      }
    });
  }
  stopWorker(key) {
    const item = this.children.get(key);
    if (item) {
      this.children.delete(key);
      item.child.kill("SIGTERM");
    }
  }
  notifyConsent() {
    if (!process.versions.electron || this.stopping || this.role !== "far") return;
    this.notifiedRequests ||= new Set();
    const pending = this.admission?.pending?.find(p => p.expiresAt > Date.now() && !this.notifiedRequests.has(p.requestId));
    if (!pending) return;
    this.notifiedRequests.add(pending.requestId);
    if (this.notifiedRequests.size > 128) this.notifiedRequests.delete(this.notifiedRequests.values().next().value);
    const appRoot = path.resolve(__dirname, "../..");
    const packaged = fs.existsSync(path.join(path.dirname(process.execPath), "resources/app"));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = cp.spawn(process.execPath, [ ...(packaged ? [] : [appRoot]), "--consent-only", "--far-state-dir", this.dir, "--profile-dir", path.dirname(this.dir), "--no-shortcuts" ], { env, detached:true, stdio:"ignore", windowsHide:false });
    child.on("error", () => this.log("consent_notification_unavailable"));
    child.unref();
  }
  targetFor(device) {
    let t = this.targets.get(device.id);
    if (!t) {
      const dir = this.file("devices/" + id(device.id));
      t = {
        id: device.id,
        dir,
        state: "waiting",
        failures: 0,
        workerFailures: 0,
        nextAt: 0,
        client: null,
        connecting: false,
        lastProbe: 0,
        probeBusy: false,
      };
      this.targets.set(device.id, t);
    }
    return t;
  }
  tick() {
    if (this.stopping) return;
    if (this.role === "far") {
      if (
        this.settings.enabled &&
        !this.children.has("far") &&
        Date.now() >= (this.farNextAt || 0)
      ) {
        this.farState = "starting";
        this.spawnWorker(
          "far",
          path.resolve(__dirname, "../remote.cjs"),
          [this.file("far")],
          this.file("far"),
        );
      }
      return;
    }
    const registry = this.registry();
    const slots = this.deviceSlots.snapshot(registry);
    const admitted = new Set(slots.active);
    for (const [key, t] of this.targets)
      if (!admitted.has(key) || !this.settings.enabled) {
        t.client?.destroy();
        t.client = null;
        t.state = slots.paused.includes(key) ? "slot_paused" : "disconnected";
        this.stopWorker(key);
      }
    for (const device of Object.values(registry)) {
      if (!admitted.has(device.id) || !this.settings.enabled) continue;
      const t = this.targetFor(device);
      if (t.state === "identity_error") continue;
      if (!this.children.has(device.id)) {
        if (Date.now() < t.nextAt) continue;
        const info = this.safeInfo(read(path.join(t.dir, "identity.json")));
        const config = {
          ...info,
          localPort: 0,
          clockSkewCorrection: true,
          reconnectPolicy: true,
          testHooks: this.testHooks,
          statusPath: path.join(t.dir, "peer.json"),
          runtimePath: path.join(t.dir, "runtime.json"),
          controllerId: this.identity.deviceId,
          controllerKeyPath: path.join(t.dir, "client_key"),
        };
        write(path.join(t.dir, "near.json"), config);
        try {
          fs.unlinkSync(path.join(t.dir, "runtime.json"));
        } catch {}
        try {
          fs.unlinkSync(path.join(t.dir, "peer.json"));
        } catch {}
        this.spawnWorker(
          device.id,
          path.resolve(__dirname, "../near.cjs"),
          [path.join(t.dir, "near.json")],
          t.dir,
        );
      }
      if (!t.client && !t.connecting && Date.now() >= t.nextAt)
        this.probe(t, device);
      else if (
        t.client &&
        !t.connecting &&
        t.state === "online" &&
        Date.now() - t.lastProbe > 30000 &&
        !t.probeBusy
      ) {
        const current = t.client;
        this.identityProbe(t, device, current).catch((e) => {
          if (t.client === current) this.failed(t, e);
        });
      }
    }
  }
  failed(t, error) {
    if (this.stopping) return;
    t.connecting = false;
    t.probeBusy = false;
    t.probeOwner = null;
    const client = t.client;
    t.client = null;
    client?.destroy();
    t.failures++;
    this.stats.disconnects++;
    const fatal =
      error.identity ||
      /host key|verification|authentication methods failed|identity differs|cloud self/i.test(
        error.message,
      );
    t.state = fatal ? "identity_error" : "retrying";
    const delay = retryDelay(t.failures);
    t.nextAt = Date.now() + delay;
    this.log("connection_failed", {
      deviceId: t.id,
      attempt: t.failures,
      delayMs: delay,
      reason: fatal
        ? "identity_or_authorization"
        : error.code || error.message.slice(0, 200),
    });
  }
  async probe(t, device) {
    t.connecting = true;
    t.state = "connecting";
    let runtime;
    try {
      runtime = read(path.join(t.dir, "runtime.json"));
      if (!runtime?.port) throw Error("Near listener is not ready");
      const peer = read(path.join(t.dir, "peer.json"), null);
      if (
        !peer ||
        peer.relayProtocol !== 2 ||
        Date.now() - peer.receivedAt > 45000
      )
        throw Error("Waiting for current authenticated protocol-2 peer");
      if (!peer.admission) {
        t.state = "unsupported_remote"; t.connecting = false; t.nextAt = Date.now() + 2000; return;
      }
      if (peer.admission.ownerId && peer.admission.ownerId !== this.identity.deviceId && peer.admission.approvedId !== this.identity.deviceId) {
        t.state = "remote_busy"; t.connecting = false; t.nextAt = Date.now() + 1000; return;
      }
    } catch (e) {
      t.connecting = false;
      t.nextAt = Date.now() + 500;
      return;
    }
    this.stats.attempts++;
    const info = this.safeInfo(read(path.join(t.dir, "identity.json"))),
      client = new Client();
    t.client = client;
    let validated = false,
      settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        this.failed(t, Error("SSH identity handshake timeout"));
      }
    }, 65000);
    const fail = (e) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        this.failed(t, e);
      } else if (validated && t.client === client) this.failed(t, e);
    };
    client.on("error", fail);
    client.on("close", () => fail(Error("SSH connection closed")));
    client.once("ready", async () => {
      try {
        await this.identityProbe(t, device, client);
        if (t.client !== client) return;
        settled = true;
        validated = true;
        clearTimeout(timer);
        t.connecting = false;
        t.state = "online";
        t.failures = 0;
        t.workerFailures = 0;
        this.stats.connected++;
        this.log("connection_verified", { deviceId: t.id });
      } catch (e) {
        fail(e);
      }
    });
    try {
      client.connect({
        host: "127.0.0.1",
        port: runtime.port,
        username: "relay",
        privateKey: fs.readFileSync(path.join(t.dir, "client_key")),
        readyTimeout: 45000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        hostVerifier: (key) => {
          const fp =
            "SHA256:" +
            crypto
              .createHash("sha256")
              .update(key)
              .digest("base64")
              .replace(/=+$/, "");
          return fp === info.fingerprint;
        },
      });
    } catch (e) {
      fail(e);
    }
  }
  async identityProbe(t, device, client = t.client) {
    if (!client) throw Error("No identity connection");
    t.probeBusy = true;
    t.probeOwner = client;
    const info = read(path.join(t.dir, "identity.json"));
    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Read-only identity probe timeout")),
          20000,
        );
        client.exec(
          info.target === "win10" ? "whoami & hostname" : "whoami; hostname",
          (e, stream) => {
            if (e) {
              clearTimeout(timer);
              reject(e);
              return;
            }
            let stdout = "",
              stderr = "";
            stream.on("data", (d) => (stdout += d));
            stream.stderr.on("data", (d) => (stderr += d));
            stream.on("error", reject);
            stream.on("close", (code) => {
              clearTimeout(timer);
              resolve({ stdout, stderr, code });
            });
          },
        );
      });
      if (t.client !== client) throw Error("Stale identity probe discarded");
      const lines = result.stdout
        .trim()
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (result.code !== 0 || lines.length !== 2)
        throw Error("Incomplete identity probe");
      if (lines[1].toLowerCase() !== info.hostname.toLowerCase()) {
        const e = Error("Actual target identity differs from paired device");
        e.identity = true;
        throw e;
      }
      const isSelf = lines[1].toLowerCase() === os.hostname().toLowerCase();
      if (isSelf && !this.allowCloudSelfTest)
        throw Error("Cloud self-test target refused");
      const report = {
        connected: true,
        agent_managed: true,
        local_port: read(path.join(t.dir, "runtime.json")).port,
        target: info.target,
        remote_user: lines[0],
        remote_hostname: lines[1],
        host_fingerprint: info.fingerprint,
        state_directory: t.dir,
        cloud_self_test: isSelf,
        permission_comparison: "not_compared_to_local_codex",
        ssh_argv: [
          "ssh",
          "-F",
          os.devNull,
          "-o",
          "BatchMode=yes",
          "-o",
          "IdentitiesOnly=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          'UserKnownHostsFile="' +
            path.join(t.dir, "known_hosts").replace(/"/g, '\\"') +
            '"',
          "-o",
          "HostKeyAlias=relay-" + info.deviceId,
          "-i",
          path.join(t.dir, "client_key"),
          "-p",
          String(read(path.join(t.dir, "runtime.json")).port),
          "relay@127.0.0.1",
        ],
      };
      write(path.join(t.dir, "connection.json"), report);
      t.lastProbe = Date.now();
      t.remoteUser = lines[0];
    } finally {
      if (t.probeOwner === client) {
        t.probeBusy = false;
        t.probeOwner = null;
      }
    }
  }
  status() {
    const registry = this.role === "near" ? this.registry() : null;
    const slots = registry ? this.deviceSlots.snapshot(registry) : null;
    const devices =
      this.role === "near"
        ? Object.values(registry).map((d) => {
            const t = this.targets.get(d.id);
            return {
              ...d,
              state: slots.paused.includes(d.id) ? "slot_paused" : t?.state || "disconnected",
              slotPaused: slots.paused.includes(d.id),
              attempts: t?.failures || 0,
              retryAt: t?.nextAt || 0,
              lastVerifiedAt: t?.lastProbe || null,
              remoteUser: t?.remoteUser || null,
              workerPid: this.children.get(d.id)?.child.pid || null,
              connectionReport:
                t?.state === "online" && slots.active.includes(d.id) && this.settings.enabled
                  ? path.join(t.dir, "connection.json")
                  : null,
            };
          })
        : Object.entries(
            read(this.file("far/authorized-clients.json"), {}),
          ).map(([id, d]) => ({ id, label: d.label, pairedAt: d.pairedAt }));
    return {
      role: this.role,
      deviceId: this.identity.deviceId,
      settings: this.settings,
      state:
        this.role === "far"
          ? this.settings.enabled
            ? this.farState || "starting"
            : "disconnected"
          : "running",
      devices,
      deviceSlots: slots,
      stats: this.stats,
      pairing: this.offer?.active
        ? { active: true, expiresAt: this.offer.expiresAt }
        : null,
      workerPid: this.children.get("far")?.child.pid || null,
      admission: this.role === "far" ? this.admission || null : undefined,
      logDirectory: this.dir,
    };
  }
  async api(req, res) {
    const reply = (code, data) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    const got = req.headers.authorization || "",
      expected = "Bearer " + this.apiToken;
    if (
      req.headers.origin ||
      !/^Bearer [a-f0-9]{64}$/.test(got) ||
      got.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))
    ) {
      reply(401, { error: "Unauthorized" });
      return;
    }
    let body = "";
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 40000) throw Error("Request too large");
      }
      const data = body ? JSON.parse(body) : {};
      let value = { ok: true };
      if (req.method === "GET" && req.url === "/status") value = this.status();
      else if (req.method === "GET" && req.url === "/logs") {
        let rows = [];
        for (const name of [
          "guardian-events.jsonl.1",
          "guardian-events.jsonl",
          "agent-events.jsonl.1",
          "agent-events.jsonl",
        ])
          try {
            rows.push(
              ...fs
                .readFileSync(this.file(name), "utf8")
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((x) => JSON.parse(x)),
            );
          } catch {}
        value = {
          events: rows
            .sort((a, b) => String(a.time).localeCompare(String(b.time)))
            .slice(-300),
        };
      } else if (req.method === "POST" && req.url === "/pair/create")
        value = await this.createPair();
      else if (req.method === "POST" && req.url === "/pair/cancel") {
        this.offer?.cancel();
      } else if (req.method === "POST" && req.url === "/pair/connect")
        value = await this.joinPair(data.code);
      else if (req.method === "POST" && req.url === "/connection/decision") {
        if (this.role !== "far" || typeof data.approve !== "boolean" || !this.admission?.pending?.some(p => p.requestId === data.requestId && p.expiresAt > Date.now())) throw Error("Unknown or expired switch request");
        const worker = this.children.get("far");
        if (!worker?.child.connected) throw Error("Far worker is not available");
        worker.child.send({ type:"control-decision", requestId:data.requestId, approve:data.approve });
        value = { queued:true };
      }
      else if (req.method === "POST" && req.url === "/settings") {
        if (typeof data.enabled === "boolean") {
          this.settings.enabled = data.enabled;
          if (!data.enabled) {
            for (const t of this.targets.values()) {
              t.client?.destroy();
              t.client = null;
            }
            for (const k of this.children.keys()) this.stopWorker(k);
          }
        }
        if (typeof data.label === "string")
          this.settings.label = data.label.slice(0, 80);
        write(this.file("settings.json"), this.settings);
        this.tick();
      } else if (req.method === "POST" && req.url === "/device") {
        const registry = this.registry(),
          key = id(data.id);
        if (!registry[key]) throw Error("Unknown paired device");
        if (this.role === "near" && data.enabled === true)
          this.deviceSlots.assertCanEnable(registry, key);
        if (typeof data.enabled === "boolean")
          registry[key].enabled = data.enabled;
        if (data.default === true) this.settings.defaultDevice = key;
        if (typeof data.label === "string")
          registry[key].label = data.label.slice(0, 80);
        this.saveRegistry(registry);
        write(this.file("settings.json"), this.settings);
        const t = this.targets.get(key);
        if (data.retry && t) {
          this.children.get(key)?.child.send({ type:"request-control" });
          t.nextAt = 0;
          t.failures = 0;
          if (t.state === "identity_error") t.state = "waiting";
        }
        this.tick();
      } else if (req.method === "POST" && req.url === "/unpair") {
        const key = id(data.id);
        if (this.role === "near") {
          const registry = this.registry();
          delete registry[key];
          this.saveRegistry(registry);
          const t = this.targets.get(key);
          t?.client?.destroy();
          this.stopWorker(key);
          this.targets.delete(key);
        } else {
          const file = this.file("far/authorized-clients.json"),
            clients = read(file, {});
          delete clients[key];
          write(file, clients);
          this.children.get("far")?.child.send({ type:"revoke-controller", controllerId:key });
        }
        this.log("device_unpaired", { deviceId: key });
      } else if (req.method === "POST" && req.url === "/retry") {
        for (const t of this.targets.values()) {
          this.children.get(t.id)?.child.send({ type:"request-control" });
          t.failures = 0;
          t.nextAt = 0;
        }
        this.tick();
      } else if (
        req.method === "POST" &&
        req.url === "/test/drop-network" &&
        this.testHooks
      ) {
        for (const item of this.children.values())
          item.child.send({ type: "test-drop-network" });
        this.log("test_network_drop");
      } else if (req.method === "POST" && req.url === "/shutdown") {
        if (typeof process.send === "function")
          process.send({ type: "stop-guardian" });
        setTimeout(() => this.close().then(() => process.exit(0)), 100);
      } else {
        reply(404, { error: "Unknown agent endpoint" });
        return;
      }
      reply(200, value);
    } catch (e) {
      this.log("api_error", {
        route: req.url,
        reason: /pair/i.test(req.url)
          ? "pairing failed"
          : e.message.slice(0, 200),
      });
      reply(400, { error: e.message });
    }
  }
  async close() {
    if (this.stopping) return;
    this.stopping = true;
    clearInterval(this.timer);
    this.offer?.cancel();
    for (const t of this.targets.values()) t.client?.destroy();
    for (const key of this.children.keys()) this.stopWorker(key);
    this.log("agent_stopped");
    await new Promise((resolve) => this.server.close(resolve));
    const own = read(path.join(this.dir, "agent.lock/owner.json"), {});
    if (own.bootId === this.bootId) {
      fs.rmSync(this.file("agent.lock"), { recursive: true, force: true });
      try {
        fs.unlinkSync(this.file("agent-runtime.json"));
      } catch {}
    }
  }
}
module.exports = { Agent, DEFAULT_BROKER };
if (require.main === module) {
  const args = process.argv.slice(2),
    arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
  const agent = new Agent({
    role: arg("--role", "near"),
    dir: arg(
      "--state-dir",
      path.join(os.homedir(), ".ssh-relay-pro", arg("--role", "near")),
    ),
    brokerUrl: arg("--broker", DEFAULT_BROKER),
    allowCloudSelfTest: args.includes("--allow-cloud-self-test"),
    testHooks: args.includes("--test-hooks"),
  });
  if (typeof process.send === "function")
    process.once("disconnect", () => agent.close().then(() => process.exit(0)));
  for (const s of ["SIGTERM", "SIGINT"])
    process.on(s, () => agent.close().then(() => process.exit(0)));
  agent.start().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
