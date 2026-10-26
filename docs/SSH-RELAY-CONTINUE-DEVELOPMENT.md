

<!-- ai-recovery-policy:start -->
## 5.5 AI 断线恢复与任务继续规则

连接断开后不允许停下汇报，不得仅报告断线、等待用户催促或要求用户手动重连。必须自动重连，失败后持续退避重试，不以重试次数耗尽为由结束任务。恢复连接后核验原目标身份，查询原操作结果并继续断线前的任务，直到完成并验证。Connection loss or a connection timeout MUST NOT end the task. Automatically reconnect using the remembered device, keep retrying with bounded backoff, and resume the original task after recovery. Do not report disconnection as the final outcome, wait for user prompting, or ask for manual reconnection. A tool timeout is an observation boundary, not a task deadline. 仅对尚未结束的连接任务轮询 connectionTaskId。已结束的配对/连接任务是历史结果，不代表当前连接；超时后必须读取实时设备状态，不得反复轮询终结任务或为普通断线重新配对。Poll connectionTaskId only while the request is pending, using ssh_connect with that ID alone. A completed pairing/connection request is historical, not live connectivity. After timeout, inspect live devices; never keep polling a terminal request or re-pair for ordinary disconnection. Use ssh_connection_status action=status and ssh_connect with the exact remembered server when live state requires recovery. Never use disconnect/reconnect as the default repair: it closes live sessions and tunnels. Preserve operationId, workflowOperationId, sessionId/requestId and transferId. Query original work before continuing; resume saved transfers rather than starting over. If IDs were lost, discover saved operations/sessions on the same verified target before submitting anything. Never blindly replay a side-effecting command or recreate a lost shell as if its state survived. Do not reset identities, re-pair, change ports or stop services to repair a transient disconnect. Explicit user stop/disconnect and authorization or identity checks remain binding; reconnection does not grant new authority. Keep credentials private.

<!-- ai-recovery-policy:end -->

# SSH Relay 继续开发

目标分支：fix/ssh-pro-startup-20261019

分工：Agent 设备管理；SDK/MCP 接入；远端任务持久化；文件续传。

提交要求：每次源码改动及时提交，并更新交接文档。严格五分钟自动备份需要在实际开发工作区的常驻执行环境配置定时任务。
