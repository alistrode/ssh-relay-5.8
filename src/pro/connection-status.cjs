"use strict";
const { withRecovery } = require("./ai-recovery.cjs");
const terminalStates = new Set(["ready", "failed", "unknown", "disconnected"]);

// A connection request is a historical transaction. It is never a live
// connectivity probe, and an unresolved pairing request cannot identify an
// already-remembered target merely because that target is online.
async function observeConnectionRequest(value, readDevices, { statusQuery = false } = {}) {
  if (!value || typeof value.connectionTaskId !== "string") return value;
  const { recovery, ...record } = value;
  const requestStatus = {
    scope: "this_request_only", state: value.state, phase: value.phase,
    ok: value.ok, terminal: terminalStates.has(value.state),
    createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
  let connectionStatus;
  try {
    const snapshot = await readDevices();
    if (snapshot.ok !== true || !Array.isArray(snapshot.devices))
      throw Object.assign(Error("Invalid live device snapshot"), { code: "INVALID_DEVICE_SNAPSHOT" });
    const observedAt = Date.now();
    const devices = snapshot.devices.map(device => {
      const age = observedAt - device.lastVerifiedAt;
      return {
        deviceId: device.id, hostname: device.hostname || "", label: device.label || "",
        state: device.state, enabled: device.enabled !== false,
        desiredConnected: device.desiredConnected !== false, slotPaused: !!device.slotPaused,
        lastVerifiedAt: device.lastVerifiedAt || null,
        verifiedOnline: device.state === "online" && device.enabled !== false &&
          device.desiredConnected !== false && !device.slotPaused &&
          Number.isFinite(device.lastVerifiedAt) && age >= 0 && age < 45000,
      };
    });
    const target = value.deviceId ? devices.find(device => device.deviceId === value.deviceId) || null : null;
    connectionStatus = {
      scope: "live_remembered_devices", available: true, observedAt,
      targetDeviceId: value.deviceId || null, targetResolved: !!target, target,
      verifiedOnlineDevices: devices.filter(device => device.verifiedOnline), devices,
      targetIdentityNote: value.deviceId
        ? "Live state is matched by the request's exact deviceId."
        : "Pairing did not identify a target. Online remembered devices are not implicitly assigned to this pairing request.",
    };
  } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'connection-status.cjs',line:43});
    connectionStatus = { scope: "live_remembered_devices", available: false,
      observedAt: Date.now(), targetDeviceId: value.deviceId || null,
      targetResolved: false, target: null, verifiedOnlineDevices: [], devices: [],
      error: { code: error.code || "LIVE_DEVICE_STATUS_UNAVAILABLE" } };
  }
  const current = !connectionStatus.available
    ? "当前设备状态读取失败；不得用历史任务结果代替实时连接状态。"
    : connectionStatus.target
      ? `当前目标设备：${connectionStatus.target.state}；已验证在线=${connectionStatus.target.verifiedOnline}。`
      : `配对目标尚未识别；当前已有 ${connectionStatus.verifiedOnlineDevices.length} 台已配对设备被验证为在线，不得据此断言目标离线或将其他设备认作本次配对目标。`;
  return withRecovery({
    statusSummary: `本次连接请求：${value.state}（仅此请求的结果）。${current}`,
    ...(statusQuery ? { statusQueryOk: true } : {}),
    ...record, requestStatus, connectionStatus,
  });
}
module.exports = { observeConnectionRequest };
