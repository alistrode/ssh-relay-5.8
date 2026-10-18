"use strict";
// Respect per-process NO_PROXY for isolated loopback fixtures and normal desktop
// deployments, while retaining the managed HTTPS proxy for public WSS brokers.
function proxyForWebSocket(address, env = process.env) {
  const url = new URL(address), host = url.hostname.toLowerCase().replace(/^\[|\]$/g, ""), port = url.port || (url.protocol === "wss:" ? "443" : "80");
  const bypass = (env.no_proxy || env.NO_PROXY || "").split(/[\s,]+/).filter(Boolean).some(value => {
    value = value.toLowerCase();
    if (value === "*") return true;
    const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(value);
    if (!match) return value === host;
    if (match[2] && match[2] !== port) return false;
    let domain = match[1].replace(/^\[|\]$/g, "");
    if (domain.startsWith("*.")) domain = domain.slice(1);
    return domain.startsWith(".") ? host.endsWith(domain) : host === domain;
  });
  return bypass ? undefined : env.https_proxy || env.HTTPS_PROXY;
}
module.exports = { proxyForWebSocket };
