"use strict";
// Shared AI-facing policy. This describes continuation; it never replays a command.
const recoveryInstructions = `连接断开后不允许停下汇报，不得仅报告断线、等待用户催促或要求用户手动重连。必须自动重连，失败后持续退避重试，不以重试次数耗尽为由结束任务。恢复连接后核验原目标身份，查询原操作结果并继续断线前的任务，直到完成并验证。Connection loss or a connection timeout MUST NOT end the task. Automatically reconnect using the remembered device, keep retrying with bounded backoff, and resume the original task after recovery. Do not report disconnection as the final outcome, wait for user prompting, or ask for manual reconnection. A tool timeout is an observation boundary, not a task deadline. 仅对尚未结束的连接任务轮询 connectionTaskId。已结束的配对/连接任务是历史结果，不代表当前连接；超时后必须读取实时设备状态，不得反复轮询终结任务或为普通断线重新配对。Poll connectionTaskId only while the request is pending, using ssh_connect with that ID alone. A completed pairing/connection request is historical, not live connectivity. After timeout, inspect live devices; never keep polling a terminal request or re-pair for ordinary disconnection. Use ssh_connection_status action=status and ssh_connect with the exact remembered server when live state requires recovery. Never use disconnect/reconnect as the default repair: it closes live sessions and tunnels. Preserve operationId, workflowOperationId, sessionId/requestId and transferId. Query original work before continuing; resume saved transfers rather than starting over. If IDs were lost, discover saved operations/sessions on the same verified target before submitting anything. Never blindly replay a side-effecting command or recreate a lost shell as if its state survived. Do not reset identities, re-pair, change ports or stop services to repair a transient disconnect. Explicit user stop/disconnect and authorization or identity checks remain binding; reconnection does not grant new authority. Keep credentials private.`;
function withRecovery(value, context = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const state = value.state;
  const live = value.connectionStatus;
  const terminalConnectionRequest = !!value.connectionTaskId &&
    (value.requestStatus?.terminal === true || ["ready", "failed", "unknown", "disconnected"].includes(state));
  const target = live?.available ? live.target : null;
  const liveTargetNeedsRecovery = !!target && !target.verifiedOnline && target.enabled &&
    target.desiredConnected && !target.slotPaused &&
    !["identity_error", "unsupported_remote", "remote_paused"].includes(target.state);
  const pending = value.completed === false ||
    ["unknown", "starting", "connecting", "retrying", "recovering", "waiting_approval", "queued", "pending", "submitted", "accepted", "running", "busy", "offline", "disconnected"].includes(state);
  const failed = value.ok === false || value.success === false || !!value.error ||
    (typeof value.code === "number" && value.code !== 0);
  const recoveringDevice = [value.devices, value.connections].some(rows => Array.isArray(rows) && rows.some(row =>
    row && !row.slotPaused && row.enabled !== false && ["retrying", "recovering", "connecting", "offline", "disconnected"].includes(row.state)));
  if (!pending && !failed && !recoveringDevice && !liveTargetNeedsRecovery) return value;
  const ids = {};
  const previous = value.recovery || {};
  for (const key of ["server", "connectionTaskId", "operationId", "workflowOperationId", "sessionId", "requestId", "transferId", "deviceId"])
    if (typeof (value[key] ?? context[key] ?? previous[key]) === "string") ids[key] = value[key] ?? context[key] ?? previous[key];
  if (!ids.sessionId && typeof (value.session ?? context.session) === "string") ids.sessionId = value.session ?? context.session;
  const next = [];
  if (ids.connectionTaskId && !terminalConnectionRequest)
    next.push({ tool: "ssh_connect", arguments: { connectionTaskId: ids.connectionTaskId } });
  else if (terminalConnectionRequest) {
    // The transaction has ended. Re-reading it cannot establish a device's
    // present connectivity, nor can an unbound pairing task identify a target.
    if (!target?.verifiedOnline) {
      next.push({ tool: "ssh_list_servers", arguments: {},
        when: "Read current verified devices; do not infer live disconnection from this completed request or assign an unrelated online device to an unresolved pairing." });
      if (liveTargetNeedsRecovery && ids.server)
        next.push({ tool: "ssh_connect", arguments: { server: ids.server },
          when: "The exact remembered target still needs recovery; retain the new connectionTaskId. Do not re-pair." });
    }
  }
  else {
    next.push({ tool: "ssh_connection_status", arguments: { action: "status", ...(ids.server ? { server: ids.server } : {}) } });
    if (ids.server) next.push({ tool: "ssh_connect", arguments: { server: ids.server }, when: "No pending connection task and remembered device needs connection; retain the returned connectionTaskId" });
    else next.push({ tool: "ssh_list_servers", arguments: {} });
  }
  {
    if (ids.operationId || ids.workflowOperationId)
      next.push({ tool: "ssh_operation_status", arguments: { operationId: ids.workflowOperationId || ids.operationId } });
    else if (ids.sessionId)
      next.push({ tool: "ssh_operation_status", arguments: { sessionId: ids.sessionId, ...(ids.requestId ? { requestId: ids.requestId } : {}) } });
    else if (ids.transferId && ids.server)
      next.push({ tool: "ssh_operation_status", arguments: { server: ids.server, transferId: ids.transferId }, afterRecovery: "Use resumeTransfer=true only to continue this saved transfer" });
    else next.push({ tool: "ssh_operation_status", arguments: ids.server ? { server: ids.server } : {}, when: "Discover original operations if their IDs were lost; do not resubmit unknown work" });
  }
  return { ...value, recovery: {
    policyVersion: "5.5", instructions: recoveryInstructions,
    onConnectionLoss: "automatically_reconnect_and_continue",
    stopOnDisconnect: false, reportDisconnectAndStop: false, requireManualReconnect: false,
    retry: { initialDelayMs: 1000, maxDelayMs: 30000, multiplier: 2, stopAfterAttempts: false },
    ...(terminalConnectionRequest ? {
      pollCompletedConnectionTask: false,
      connectionDecisionSource: "connectionStatus live snapshot, never historical request state",
      pairingRequiredForOrdinaryDisconnect: false,
    } : {}),
    replayOriginalCommand: false, ...ids, next,
  } };
}
module.exports = { recoveryInstructions, withRecovery };
