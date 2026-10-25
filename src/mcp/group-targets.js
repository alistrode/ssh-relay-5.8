// Resolve group membership before starting any remote command. Two aliases
// pointing to one verified device must never execute a command twice.
export function planGroupTargets(servers, resolve) {
  if (!Array.isArray(servers) || servers.length < 1 || servers.length > 20)
    throw new Error("Group execution requires between one and twenty targets");
  const seen = new Set(), names = new Set();
  for (const name of servers) {
    if (typeof name !== "string" || !name)
      throw new Error("Invalid group server name");
    const alias = name.toLowerCase();
    if (names.has(alias)) throw new Error("Group contains duplicate server names");
    names.add(alias);
    let config;
    try { config = resolve(name); } catch { continue; }
    const identity = config?.agentDeviceId
      ? "device:" + config.agentDeviceId
      : "legacy:" + String(config?.name || name).toLowerCase();
    if (seen.has(identity))
      throw new Error("Group contains duplicate target devices");
    seen.add(identity);
  }
  return servers.slice();
}
