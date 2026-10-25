"use strict";
// Shared AI-facing policy. This describes continuation; it never replays a command.
const recoveryInstructions = `连接断开后不允许停下汇报，不得仅报告断线、等待用户催促或要求用户手动重连。必须自动重连，失败后持续退避重试，不以重试次数耗尽为由结束任务。恢复连接后核验原目标身份，查询原操作结果并继续断线前的任务，直到完成并验证。Connection loss or a connection timeout MUST NOT end the task. Automatically reconnect using the remembered device, keep retrying with bounded backoff, and resume the original task after recovery. Do not report disconnection as the final outcome, wait for user prompting, or ask for manual reconnection. A tool timeout is an observation boundary, not a task deadline. Query an existing connectionTaskId with ssh_connect using that ID alone; otherwise use ssh_connection_status action=status and, in Agent mode, ssh_connect with the remembered server when needed. In legacy mode ssh_connect/ssh_operation_status are unavailable: let the existing transport recover, use a harmless identity probe through the original tool to establish the connection, and inspect actual effects. Never use disconnect/reconnect as the default repair: it closes live sessions and tunnels. Preserve operationId, workflowOperationId, sessionId/requestId and transferId. Query original work before continuing; resume saved transfers rather than starting over. If IDs were lost, discover saved operations/sessions on the same verified target before submitting anything. Never blindly replay a side-effecting command or recreate a lost shell as if its state survived. For legacy targets, reconnect and inspect actual remote effects before deciding how to continue. Do not reset identities, re-pair, change ports or stop services to repair a transient disconnect. Explicit user stop/disconnect and authorization or identity checks remain binding; reconnection does not grant new authority. Keep credentials private.`;
function withRecovery(value, context = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const state = value.state;
  const pending = value.completed === false ||
    ["unknown", "starting", "connecting", "retrying", "recovering", "waiting_approval", "queued", "pending", "submitted", "accepted", "running", "busy", "offline", "disconnected"].includes(state);
  const failed = value.ok === false || value.success === false || !!value.error ||
    (typeof value.code === "number" && value.code !== 0);
  const recoveringDevice = [value.devices, value.connections].some(rows => Array.isArray(rows) && rows.some(row =>
    row && !row.slotPaused && row.enabled !== false && ["retrying", "recovering", "connecting", "offline", "disconnected"].includes(row.state)));
  if (!pending && !failed && !recoveringDevice) return value;
  const ids = {};
  const previous = value.recovery || {};
  for (const key of ["server", "connectionTaskId", "operationId", "workflowOperationId", "sessionId", "requestId", "transferId", "deviceId"])
    if (typeof (value[key] ?? context[key] ?? previous[key]) === "string") ids[key] = value[key] ?? context[key] ?? previous[key];
  if (!ids.sessionId && typeof (value.session ?? context.session) === "string") ids.sessionId = value.session ?? context.session;
  const next = [];
  if (ids.connectionTaskId) next.push({ tool: "ssh_connect", arguments: { connectionTaskId: ids.connectionTaskId } });
  else {
    next.push({ tool: "ssh_connection_status", arguments: { action: "status", ...(ids.server ? { server: ids.server } : {}) } });
    if (ids.server && context.agentMode !== false) next.push({ tool: "ssh_connect", arguments: { server: ids.server }, when: "No pending connection task and remembered device needs connection; retain the returned connectionTaskId" });
    else next.push({ tool: "ssh_list_servers", arguments: {} });
  }
  if (context.agentMode !== false) {
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
    replayOriginalCommand: false, ...ids, next,
    ...(context.agentMode === false ? { legacy: true,
      afterRecovery: "Verify identity with a harmless probe through an original tool and inspect original effects; persistent status tools are unavailable" } : {}),
  } };
}
module.exports = { recoveryInstructions, withRecovery };
