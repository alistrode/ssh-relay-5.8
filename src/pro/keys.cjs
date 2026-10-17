"use strict";
const crypto = require("node:crypto"),
  { utils } = require("ssh2");
const str = (b) => {
  b = Buffer.isBuffer(b) ? b : Buffer.from(b);
  const n = Buffer.alloc(4);
  n.writeUInt32BE(b.length);
  return Buffer.concat([n, b]);
};
function keyPair(comment = "relay-pro") {
  const p = crypto.generateKeyPairSync("ed25519");
  const pub = p.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
    seed = p.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const blob = Buffer.concat([str("ssh-ed25519"), str(pub)]),
    check = crypto.randomBytes(4),
    one = Buffer.from([0, 0, 0, 1]);
  let body = Buffer.concat([
    check,
    check,
    str("ssh-ed25519"),
    str(pub),
    str(Buffer.concat([seed, pub])),
    str(comment),
  ]);
  const pad = 8 - (body.length % 8);
  body = Buffer.concat([
    body,
    Buffer.from(Array.from({ length: pad }, (_, i) => i + 1)),
  ]);
  const data = Buffer.concat([
    Buffer.from("openssh-key-v1\0"),
    str("none"),
    str("none"),
    str(""),
    one,
    str(blob),
    str(body),
  ]).toString("base64");
  const privateKey =
    "-----BEGIN OPENSSH PRIVATE KEY-----\n" +
    data.match(/.{1,70}/g).join("\n") +
    "\n-----END OPENSSH PRIVATE KEY-----\n";
  const parsed = utils.parseKey(privateKey);
  if (parsed instanceof Error) throw parsed;
  return {
    privateKey,
    publicKey: "ssh-ed25519 " + blob.toString("base64"),
    fingerprint:
      "SHA256:" +
      crypto
        .createHash("sha256")
        .update(blob)
        .digest("base64")
        .replace(/=+$/, ""),
  };
}
module.exports = { keyPair };
