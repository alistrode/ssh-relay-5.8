

<!-- ai-recovery-policy:start -->
## 5.5 AI 断线恢复与任务继续规则

连接断开后不允许停下汇报，不得仅报告断线、等待用户催促或要求用户手动重连。必须自动重连，失败后持续退避重试，不以重试次数耗尽为由结束任务。恢复连接后核验原目标身份，查询原操作结果并继续断线前的任务，直到完成并验证。Connection loss or a connection timeout MUST NOT end the task. Automatically reconnect using the remembered device, keep retrying with bounded backoff, and resume the original task after recovery. Do not report disconnection as the final outcome, wait for user prompting, or ask for manual reconnection. A tool timeout is an observation boundary, not a task deadline. 仅对尚未结束的连接任务轮询 connectionTaskId。已结束的配对/连接任务是历史结果，不代表当前连接；超时后必须读取实时设备状态，不得反复轮询终结任务或为普通断线重新配对。Poll connectionTaskId only while the request is pending, using ssh_connect with that ID alone. A completed pairing/connection request is historical, not live connectivity. After timeout, inspect live devices; never keep polling a terminal request or re-pair for ordinary disconnection. Use ssh_connection_status action=status and ssh_connect with the exact remembered server when live state requires recovery. Never use disconnect/reconnect as the default repair: it closes live sessions and tunnels. Preserve operationId, workflowOperationId, sessionId/requestId and transferId. Query original work before continuing; resume saved transfers rather than starting over. If IDs were lost, discover saved operations/sessions on the same verified target before submitting anything. Never blindly replay a side-effecting command or recreate a lost shell as if its state survived. Do not reset identities, re-pair, change ports or stop services to repair a transient disconnect. Explicit user stop/disconnect and authorization or identity checks remain binding; reconnection does not grant new authority. Keep credentials private.

<!-- ai-recovery-policy:end -->

# SSH Relay 5.5 开发与远程操作

用户明确授权独立的纯云端发行版，标注“仅限云端下载使用”。仅 Linux 云端包使用 cloud/client-lifecycle.cjs 替换生命周期模块，允许无图形界面运行；桌面发行包继续要求客户端与后台一起运行。云端与桌面配置互斥，不迁移旧分支；已有可运行包必须随源码上传。

使用本分支的连接 Skill 和 MCP/CLI 支持的入口。普通连接断开不能成为结束用户任务的理由。

恢复提示规则来自 src/pro/ai-recovery.cjs；改动后运行 node scripts/sync-ai-recovery.cjs，保持文档同步。保持 37 个原工具与 2 个 Agent 工具的名称和参数兼容，仅同步真实容量为 20。

5.5 必须客户端与后台一起启动；仅托盘退出是主动退出，其余意外退出由客户端守护恢复。不再安装独立后台服务。设备连接与被连接上限各 20，批量操作和按钮反馈适用于两端。GitHub 实际运行使用 .github/workflows/run-5.5.yml，不创建测试套件。

按用户要求，5.5 删除全部项目自有测试、测试数据、测试入口和测试工作流，不再创建或运行测试。构建命令为 npm run build。

5.5 只连接 5.5：禁止加入任何旧分支兼容或降级逻辑。旧连接块只能由对应旧分支程序处理，不能交给本分支。默认配置、快捷方式、命名空间和协议均独立；不得占用、关闭、迁移或覆盖 5.4 的进程、服务、端口和数据。
