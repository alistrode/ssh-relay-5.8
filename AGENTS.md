

<!-- ai-recovery-policy:start -->
## 5.5 AI 断线恢复与任务继续规则

连接断开后不允许停下汇报，不得仅报告断线、等待用户催促或要求用户手动重连。必须自动重连，失败后持续退避重试，不以重试次数耗尽为由结束任务。恢复连接后核验原目标身份，查询原操作结果并继续断线前的任务，直到完成并验证。Connection loss or a connection timeout MUST NOT end the task. Automatically reconnect using the remembered device, keep retrying with bounded backoff, and resume the original task after recovery. Do not report disconnection as the final outcome, wait for user prompting, or ask for manual reconnection. A tool timeout is an observation boundary, not a task deadline. Query an existing connectionTaskId with ssh_connect using that ID alone; otherwise use ssh_connection_status action=status and, in Agent mode, ssh_connect with the remembered server when needed. In legacy mode ssh_connect/ssh_operation_status are unavailable: let the existing transport recover, use a harmless identity probe through the original tool to establish the connection, and inspect actual effects. Never use disconnect/reconnect as the default repair: it closes live sessions and tunnels. Preserve operationId, workflowOperationId, sessionId/requestId and transferId. Query original work before continuing; resume saved transfers rather than starting over. If IDs were lost, discover saved operations/sessions on the same verified target before submitting anything. Never blindly replay a side-effecting command or recreate a lost shell as if its state survived. For legacy targets, reconnect and inspect actual remote effects before deciding how to continue. Do not reset identities, re-pair, change ports or stop services to repair a transient disconnect. Explicit user stop/disconnect and authorization or identity checks remain binding; reconnection does not grant new authority. Keep credentials private.

<!-- ai-recovery-policy:end -->

# SSH Relay 5.5 开发与远程操作

使用本分支的连接 Skill 和 MCP/CLI 支持的入口。普通连接断开不能成为结束用户任务的理由。

恢复提示规则来自 src/pro/ai-recovery.cjs；改动后运行 node scripts/sync-ai-recovery.cjs，保持文档同步。保持 37 个原工具与 2 个 Agent 工具的名称和参数兼容，仅同步真实容量为 20。

5.5 必须客户端与后台一起启动；仅托盘退出是主动退出，其余意外退出由客户端守护恢复。不再安装独立后台服务。设备连接与被连接上限各 20，批量操作和按钮反馈适用于两端。GitHub 实际运行使用 .github/workflows/run-5.5.yml，不创建测试套件。

按用户要求，5.5 删除全部项目自有测试、测试数据、测试入口和测试工作流，不再创建或运行测试。构建命令为 npm run build。
