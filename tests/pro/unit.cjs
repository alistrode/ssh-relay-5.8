"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { retryDelay, write, read } = require("../../src/pro/store.cjs"),
  {
    linuxUnit,
    linuxLogin,
    windowsXml,
  } = require("../../src/pro/autostart.cjs"),
  { keyPair } = require("../../src/pro/keys.cjs"),
  { utils } = require("ssh2");
test("three immediate recovery opportunities followed by bounded exponential backoff", () =>
  assert.deepEqual(
    Array.from({ length: 11 }, (_, i) => retryDelay(i + 1)),
    [0, 0, 0, 2000, 4000, 8000, 16000, 30000, 60000, 60000, 60000],
  ));
test("private atomic state survives replacement and refuses symlinks", () => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "relay-pro-unit-"));
  try {
    const p = path.join(r, "state.json");
    write(p, { counter: 1 });
    write(p, { counter: 2 });
    assert.deepEqual(read(p), { counter: 2 });
    if (process.platform !== "win32") assert.equal(fs.statSync(p).mode & 0o777, 0o600);
    fs.symlinkSync(p, path.join(r, "link"));
    assert.throws(() => write(path.join(r, "link"), {}));
  } finally {
    fs.rmSync(r, { recursive: true, force: true });
  }
});
test("persisted SSH key has a matching host fingerprint and valid signatures", () => {
  const key = keyPair(),
    privateKey = utils.parseKey(key.privateKey),
    publicKey = utils.parseKey(key.publicKey),
    data = Buffer.from("identity proof");
  assert.equal(publicKey.verify(data, privateKey.sign(data)), true);
  assert.equal(key.fingerprint.startsWith("SHA256:"), true);
});
test("autostart service descriptors use isolated profiles, explicit account, and service runtime", () => {
  const o = {
    executable: "/opt/SSH Relay/app",
    appRoot: "/opt/SSH Relay/resources/app",
    profile: "/home/user/private profile",
    user: "user",
    role: "near",
  };
  const unit = linuxUnit(o);
  assert(unit.includes("User=user"));
  assert(unit.includes("ELECTRON_RUN_AS_NODE=1"));
  assert(unit.includes("--role near"));
  assert(unit.includes("Restart=on-failure"));
  assert(!unit.includes("User=root"));
  const login = linuxLogin({ ...o, development: false });
  assert(login.includes("--tray"));
  assert(login.includes("Terminal=false"));
  const xml = windowsXml(o);
  assert(xml.includes("<startmode>Automatic</startmode>"));
  assert(xml.includes('<env name="ELECTRON_RUN_AS_NODE"'));
  assert(xml.includes("LocalSystem"));
});

test("service descriptors supervise the background agent", () => {
  const value = linuxUnit({
    executable: "/app/runtime",
    appRoot: "/app",
    profile: "/state",
    role: "far",
    user: "owner",
  });
  assert(value.includes("src/pro/guardian.cjs"));
});
test("a PID left by another OS boot is never mistaken for the saved agent", () => {
  const { ownedProcess, systemBootId } = require("../../src/pro/store.cjs");
  if (systemBootId())
    assert.equal(
      ownedProcess(process.pid, "/irrelevant", "agent", "different-boot"),
      false,
    );
});

test(
  "Linux startup descriptors pass the systemd parser, including paths with spaces",
  { skip: process.platform !== "linux" },
  () => {
    const cp = require("node:child_process");
    if (
      cp.spawnSync("systemd-analyze", ["--version"], { stdio: "ignore" }).error
    )
      return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "relay-pro-service-"));
    try {
      const appRoot = path.join(root, "application with spaces");
      fs.mkdirSync(appRoot);
      const file = path.join(root, "relay-pro-parser.service");
      fs.writeFileSync(
        file,
        linuxUnit({
          executable: process.execPath,
          appRoot,
          profile: path.join(root, "private state"),
          role: "near",
        }),
      );
      const result = cp.spawnSync("systemd-analyze", ["verify", file], {
        encoding: "utf8",
        timeout: 15000,
      });
      assert.equal(result.status, 0, result.stderr);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
