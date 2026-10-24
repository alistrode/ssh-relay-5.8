"use strict";
// Temporary diagnostic transport only. The user's SSH key stays at the client.
const fs = require("node:fs"), cp = require("node:child_process");
const { createRelay } = require("../src/relay.cjs");
const inputs = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).inputs;
if (!/^[a-z0-9-]+\.trycloudflare\.com$/.test(inputs.debug_host)) throw Error("Invalid authorized endpoint");
const config = JSON.parse(inputs.bridge_config);
if (config.broker !== "wss://broker.emqx.io:8084/mqtt" || !/^[a-f0-9]{32}$/.test(config.session) || !/^[a-f0-9]{64}$/.test(config.secret)) throw Error("Invalid temporary bridge configuration");
console.log("::add-mask::" + config.secret);
const child = cp.spawn("./cloudflared", ["access", "tcp", "--hostname", inputs.debug_host, "--url", "127.0.0.1:22022", "--logfile", "cloudflared.log"], {stdio:"ignore"});
const relay = createRelay({...config,sshPort:22022,clockSkewCorrection:true}, "far");
const status = () => relay.status({fingerprint:config.fingerprint,diagnosticBridge:true}).catch(()=>{});
relay.on("ready",()=>{console.log("Authorized diagnostic byte transport ready; SSH authentication remains at the client");status();});
relay.on("diagnostic",()=>console.log("Temporary transport reconnecting"));
child.on("error",()=>{console.error("Cloudflare helper failed to start");process.exitCode=1;relay.close();});
const timer=setInterval(status,15000);
function close(){clearInterval(timer);relay.close();child.kill();setTimeout(()=>process.exit(),500).unref();}
process.on("SIGTERM",close);process.on("SIGINT",close);setTimeout(close,45*60*1000);
