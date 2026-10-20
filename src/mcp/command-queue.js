// Business commands share two slots per verified SSH connection. Identity
// probes bypass this queue so connection control cannot be starved by commands.
const gates = new WeakMap();
function failure(code, message) {
  return Object.assign(Error(message), { code });
}
function close(gate) {
  gate.closed = true;
  for (const entry of gate.queue.splice(0)) {
    clearTimeout(entry.timer);
    entry.reject(failure("CONNECTION_CLOSED", "SSH connection closed while command was queued"));
  }
}
export async function withCommandSlot(conn, timeout, work) {
  if (!conn.verified) return work(timeout);
  let gate = gates.get(conn);
  if (!gate) {
    gate = { active: 0, queue: [], closed: false };
    gates.set(conn, gate);
    conn.client.once("close", () => close(gate));
  }
  const deadline = Date.now() + timeout;
  const release = await new Promise((resolve, reject) => {
    if (gate.closed || !conn.connected) {
      reject(failure("CONNECTION_CLOSED", "SSH connection is no longer available"));
      return;
    }
    const grant = () => {
      gate.active++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        gate.active--;
        if (!gate.closed) {
          const next = gate.queue.shift();
          if (next) { clearTimeout(next.timer); next.grant(); }
        }
      });
    };
    if (gate.active < 2) { grant(); return; }
    if (gate.queue.length >= 64) {
      reject(failure("COMMAND_CAPACITY", "Device command queue is full"));
      return;
    }
    const entry = { grant, reject };
    entry.timer = setTimeout(() => {
      const index = gate.queue.indexOf(entry);
      if (index >= 0) gate.queue.splice(index, 1);
      reject(failure("COMMAND_QUEUE_TIMEOUT", "Command timed out before execution; it was not sent"));
    }, timeout);
    gate.queue.push(entry);
  });
  try {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw failure("COMMAND_QUEUE_TIMEOUT", "Command timed out before execution; it was not sent");
    if (gate.closed || !conn.connected) throw failure("CONNECTION_CLOSED", "SSH connection closed before command execution");
    return await work(remaining);
  } finally { release(); }
}
