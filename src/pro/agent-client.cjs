"use strict";
const http = require("node:http"),
  path = require("node:path"),
  { read } = require("./store.cjs");
function request(dir, route, body) {
  return new Promise((resolve, reject) => {
    let runtime;
    try {
      runtime = read(path.join(dir, "agent-runtime.json"));
      if (!runtime) throw Error("Agent is not running");
      if (!Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535 ||
          !/^[a-f0-9]{64}$/.test(runtime.token))
        throw Error("Invalid local Agent endpoint");
    } catch (e) {
      reject(e);
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
        timeout: 110000,
      },
      (res) => {
        let data = "";
        res.on("error", reject);
        res.on("aborted", () => reject(Error("Agent response interrupted")));
        res.on("data", (b) => {
          data += b;
          if (Buffer.byteLength(data) > 2 * 1024 * 1024)
            r.destroy(Error("Agent response too large"));
        });
        res.on("end", () => {
          try {
            const value = JSON.parse(data);
            res.statusCode === 200
              ? resolve(value)
              : reject(Error(value.error || "Agent request failed"));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    r.on("error", reject);
    r.on("timeout", () => r.destroy(Error("Agent request timeout")));
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

module.exports = { request };
