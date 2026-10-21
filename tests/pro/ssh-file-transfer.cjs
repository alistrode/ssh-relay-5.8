"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { Server, Client, utils } = require("ssh2");
const { keyPair } = require("../../src/pro/keys.cjs");
const { serveSftp } = require("../../src/sftp.cjs");
const { serveControl } = require("../../src/pro/control-channel.cjs");
const { openControl } = require("../../src/pro/agent-control.cjs");
const { dispatchFarControl } = require("../../src/pro/far-control.cjs");
const { publicFailure } = require("../../src/pro/task-result.cjs");
const { FileService } = require("../../src/pro/file-service.cjs");
const vm = require("node:vm"), { pathToFileURL } = require("node:url");
const { digest } = require("../../src/pro/file-transfer.cjs");
const call = (s, method, ...args) => new Promise((resolve, reject) => s[method](...args, (e, value) => e ? reject(e) : resolve(value)));
test("actual loopback SSH/SFTP and owner-bound control carry a hash-confirmed upload", { timeout: 20000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-ssh-file-")), host = keyPair(), credential = keyPair();
  const owner = crypto.randomUUID(), deviceId = crypto.randomUUID();
  fs.mkdirSync(path.join(dir, "far")); const authorizedFile = path.join(dir, "far/authorized-clients.json");
  fs.writeFileSync(authorizedFile, JSON.stringify({ [owner]: {} }));
  const agent = { identity: { deviceId }, file: name => path.join(dir, name), remoteFiles: new FileService({ dir: path.join(dir, "transfers"), deviceId,
    authorizedFile, authorized: id => !!JSON.parse(fs.readFileSync(authorizedFile))[id] }) };
  const key = utils.parseKey(credential.privateKey), clients = new Set();
  const server = new Server({ hostKeys: [host.privateKey] });
  server.on("connection", peer => {
    clients.add(peer); peer.on("error", () => {}); peer.on("close", () => clients.delete(peer));
    peer.on("authentication", ctx => {
      if (ctx.method === "publickey" && ctx.key.data.equals(key.getPublicSSH()) && (!ctx.signature || key.verify(ctx.blob, ctx.signature, ctx.hashAlgo))) ctx.accept(); else ctx.reject();
    });
    peer.on("ready", () => peer.on("session", accept => {
      const session = accept();
      session.on("sftp", acceptSftp => serveSftp(acceptSftp()));
      session.on("subsystem", (acceptControl, reject, info) => {
        if (info.name !== "relay-control-v1") return reject();
        serveControl(acceptControl(), async (method, params) => {
          try { return await dispatchFarControl(agent, owner, method, params); }
          catch (error) { throw Object.assign(Error(publicFailure(error).message), publicFailure(error)); }
        });
      });
    }));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const ssh = new Client();
  t.after(async () => { ssh.destroy(); for (const c of clients) c.end(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { ssh.once("ready", resolve); ssh.once("error", reject); ssh.connect({ host: "127.0.0.1", port: server.address().port, username: "test", privateKey: credential.privateKey,
    readyTimeout: 5000, hostVerifier: data => "SHA256:" + crypto.createHash("sha256").update(data).digest("base64").replace(/=+$/, "") === host.fingerprint }); });
  const control = await openControl(ssh, deviceId), id = crypto.randomUUID(), bytes = crypto.randomBytes(1024 * 1024 + 11), blocks = [digest(bytes.subarray(0, 1024 * 1024)), digest(bytes.subarray(1024 * 1024))];
  try {
    await assert.rejects(control.request("file.status", { transferId: id }), { code: "TRANSFER_NOT_FOUND" });
    const prepared = await control.request("file.prepare", { transferId: id, target: path.join(dir, "result.bin"), size: bytes.length, sha256: digest(bytes), blocks, policy: "overwrite" });
    const sftp = await new Promise((resolve, reject) => ssh.sftp((e, s) => e ? reject(e) : resolve(s)));
    const handle = await call(sftp, "open", prepared.temporary, "r+");
    try { for (let i = 0; i < blocks.length; i++) { const block = bytes.subarray(i * 1024 * 1024, Math.min((i + 1) * 1024 * 1024, bytes.length)); await call(sftp, "write", handle, block, 0, block.length, i * 1024 * 1024); await control.request("file.block", { transferId: id, index: i, sha256: blocks[i] }); } }
    finally { await call(sftp, "close", handle); }
    assert.equal((await control.request("file.commit", { transferId: id })).state, "completed");
    assert.deepEqual(fs.readFileSync(path.join(dir, "result.bin")), bytes);
    if (typeof vm.SourceTextModule === "function") {
      const stateRoot = path.join(dir, "mcp-state"); fs.mkdirSync(stateRoot);
      let writes = 0, loseWrite = true;
      const target = { client: ssh, config: { agentDeviceId: deviceId, platform: "linux", capabilities: { fileProtocol: 1 } } };
      const realSftp = await new Promise((resolve, reject) => ssh.sftp((e, s) => e ? reject(e) : resolve(s)));
      const transport = { connect: async () => target, sftp: async () => realSftp,
        sftpCall: async (s, method, ...args) => {
          const value = await call(s, method, ...args);
          if (method === "write") {
            writes++;
            if (loseWrite && writes === 2) { loseWrite = false; throw Object.assign(Error("Injected lost write acknowledgement"), { code: "CONTROL_CLOSED" }); }
          }
          return value;
        } };
      const context = vm.createContext({ Buffer, console, setTimeout, clearTimeout });
      const synthetic = (exports, identifier) => new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
      }, { context, identifier });
      const modulePath = path.resolve(__dirname, "../../src/mcp/file-transfers.js");
      const module = new vm.SourceTextModule(fs.readFileSync(modulePath, "utf8"), { context,
        identifier: pathToFileURL(modulePath).href, initializeImportMeta: meta => { meta.url = pathToFileURL(modulePath).href; } });
      await module.link(spec => {
        if (spec === "./transport.js") return synthetic(transport, spec);
        if (spec === "./state.js") return synthetic({ statePath: name => path.join(stateRoot, name) }, spec);
        if (spec === "node:module") return synthetic({ createRequire: require("node:module").createRequire }, spec);
        if (spec === "node:fs") return synthetic({ default: fs }, spec);
        if (spec === "node:crypto") return synthetic({ default: crypto }, spec);
        throw Error("Unexpected file-transfer dependency");
      });
      await module.evaluate();
      const source = path.join(dir, "mcp-source"), uploaded = path.join(dir, "mcp-uploaded"), downloaded = path.join(dir, "mcp-downloaded");
      fs.writeFileSync(source, bytes); let transferId;
      await assert.rejects(module.namespace.uploadSnapshot("test", source, uploaded), error => {
        transferId = error.transferId; return /^[a-f0-9-]{36}$/.test(transferId);
      });
      fs.writeFileSync(source, "The original source changed after its immutable snapshot");
      const resumed = await module.namespace.resumeUpload("test", transferId);
      assert.equal(resumed.completed, true); assert.equal(writes, 3);
      assert.deepEqual(fs.readFileSync(uploaded), bytes);
      const received = await module.namespace.downloadSnapshot("test", uploaded, downloaded);
      assert.equal(received.completed, true); assert.deepEqual(fs.readFileSync(downloaded), bytes);
    }
    fs.writeFileSync(authorizedFile, "{}");
    await assert.rejects(control.request("file.status", { transferId: id }), { code: "AUTH_REVOKED" });
  } finally { control.close(); }
});
