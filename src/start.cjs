var fs = require("node:fs");
var path = require("node:path");
var crypto = require("node:crypto");
var zlib = require("node:zlib");
var { utils } = require("ssh2");
var { inspectPermissions, requireUsableContext } = require("./permissions.cjs");
requireUsableContext(inspectPermissions());
var data = path.resolve(__dirname, "..", "data");
fs.mkdirSync(data, { recursive: true, mode: 448 });
var text = (b) => Buffer.from(b);
var u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
var str = (b) => {
  b = Buffer.isBuffer(b) ? b : text(b);
  return Buffer.concat([u32(b.length), b]);
};
function keyPair(comment) {
  const pair = crypto.generateKeyPairSync("ed25519");
  const pub = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const seed = pair.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const blob = Buffer.concat([str("ssh-ed25519"), str(pub)]);
  const check = crypto.randomBytes(4);
  let body = Buffer.concat([check, check, str("ssh-ed25519"), str(pub), str(Buffer.concat([seed, pub])), str(comment)]);
  const pad = 8 - body.length % 8;
  body = Buffer.concat([body, Buffer.from(Array.from({ length: pad }, (_, i) => i + 1))]);
  const encoded = Buffer.concat([text("openssh-key-v1\0"), str("none"), str("none"), str(""), u32(1), str(blob), str(body)]).toString("base64");
  const privateKey = "-----BEGIN OPENSSH PRIVATE KEY-----\n" + encoded.match(/.{1,70}/g).join("\n") + "\n-----END OPENSSH PRIVATE KEY-----\n";
  const parsed = utils.parseKey(privateKey);
  if (parsed instanceof Error) throw parsed;
  return { privateKey, publicKey: "ssh-ed25519 " + blob.toString("base64"), fingerprint: "SHA256:" + crypto.createHash("sha256").update(blob).digest("base64").replace(/=+$/, "") };
}
var bundlePath = path.join(data, "connection-private.json");
var info;
if (fs.existsSync(bundlePath)) {
  info = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
} else {
  const host = keyPair("ssh-relay-host");
  const client = keyPair("ssh-relay-client");
  info = { version: 1, target: process.platform === "win32" ? "win10" : "linux", broker: "wss://broker.emqx.io:8084/mqtt", session: crypto.randomBytes(16).toString("hex"), secret: crypto.randomBytes(32).toString("hex"), user: "relay", fingerprint: host.fingerprint, hostPublicKey: host.publicKey, clientPrivateKey: client.privateKey };
  fs.writeFileSync(path.join(data, "host_key"), host.privateKey, { mode: 384, flag: "wx" });
  fs.writeFileSync(path.join(data, "client_key.pub"), client.publicKey + "\n", { mode: 384, flag: "wx" });
  fs.writeFileSync(path.join(data, "remote.json"), JSON.stringify({ ...info, clientPrivateKey: void 0, hostPublicKey: void 0, sshPort: 0 }), { mode: 384, flag: "wx" });
  fs.writeFileSync(bundlePath, JSON.stringify(info), { mode: 384, flag: "wx" });
}
console.log("The following block is a PRIVATE connection credential. Share only with your trusted AI.");
console.log("========== SSH_RELAY_CONNECT_BEGIN ==========");
console.log("TARGET=" + info.target);
console.log("BUNDLE=" + zlib.gzipSync(Buffer.from(JSON.stringify(info))).toString("base64"));
console.log("========== SSH_RELAY_CONNECT_END ==========");
process.argv[2] = data;
require("./remote.cjs");
