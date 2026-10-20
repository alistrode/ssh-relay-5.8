"use strict";
const { ControlClient } = require("./control-channel.cjs");
function failure(code, message) { return Object.assign(Error(message), { code, retryable: true }); }
async function openControl(ssh, deviceId) {
  const stream = await new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { done = true; reject(failure("CONTROL_TIMEOUT", "Control subsystem did not open")); }, 5000);
    try {
      ssh.subsys("relay-control-v1", (error, stream) => {
        clearTimeout(timer);
        if (done) { stream?.close(); return; }
        done = true;
        if (error) reject(error); else resolve(stream);
      });
    } catch (error) { clearTimeout(timer); reject(error); }
  });
  const client = new ControlClient(stream);
  try {
    const hello = await client.request("hello", { protocol: 1 }, { timeoutMs: 5000 });
    if (hello.protocol !== 1 || hello.deviceId !== deviceId || hello.capabilities?.taskProtocol !== 1)
      throw failure("CONTROL_PROTOCOL_MISMATCH", "Verified target does not support this task protocol");
    client.capabilities = hello.capabilities;
    return client;
  } catch (error) { client.close(); throw error; }
}
async function agentControl(agent, deviceId) {
  agent.connections.descriptor(deviceId);
  const target = agent.targets.get(deviceId), generation = target.generation, ssh = target.client;
  if (target.controlClient && !target.controlClient.channel.closed()) return target.controlClient;
  if (target.controlPending) return target.controlPending;
  const pending = openControl(ssh, deviceId).then(client => {
    if (target.generation !== generation || target.client !== ssh || agent.stopping) {
      client.close(); throw failure("STALE_CONNECTION", "Device control connection changed");
    }
    target.controlClient = client;
    return client;
  });
  target.controlPending = pending;
  try { return await pending; }
  finally { if (target.controlPending === pending) target.controlPending = null; }
}
module.exports = { openControl, agentControl };
