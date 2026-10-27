

<!-- ai-recovery-policy:start -->
## 5.7 AI 断线恢复与任务继续规则

连接断开后不允许停下汇报，不得仅报告断线、等待用户催促或要求用户手动重连。必须自动重连，失败后持续退避重试，不以重试次数耗尽为由结束任务。恢复连接后核验原目标身份，查询原操作结果并继续断线前的任务，直到完成并验证。Connection loss or a connection timeout MUST NOT end the task. Automatically reconnect using the remembered device, keep retrying with bounded backoff, and resume the original task after recovery. Do not report disconnection as the final outcome, wait for user prompting, or ask for manual reconnection. A tool timeout is an observation boundary, not a task deadline. 仅对尚未结束的连接任务轮询 connectionTaskId。已结束的配对/连接任务是历史结果，不代表当前连接；超时后必须读取实时设备状态，不得反复轮询终结任务或为普通断线重新配对。Poll connectionTaskId only while the request is pending, using ssh_connect with that ID alone. A completed pairing/connection request is historical, not live connectivity. After timeout, inspect live devices; never keep polling a terminal request or re-pair for ordinary disconnection. Use ssh_connection_status action=status and ssh_connect with the exact remembered server when live state requires recovery. Never use disconnect/reconnect as the default repair: it closes live sessions and tunnels. Preserve operationId, workflowOperationId, sessionId/requestId and transferId. Query original work before continuing; resume saved transfers rather than starting over. If IDs were lost, discover saved operations/sessions on the same verified target before submitting anything. Never blindly replay a side-effecting command or recreate a lost shell as if its state survived. Do not reset identities, re-pair, change ports or stop services to repair a transient disconnect. Explicit user stop/disconnect and authorization or identity checks remain binding; reconnection does not grant new authority. Keep credentials private.

<!-- ai-recovery-policy:end -->

# 5.7 AI 自动重连与任务继续

## 覆盖范围

MCP 初始化 instructions、全部 5 个工作流提示、relay-mcp://guide、连接 Skill、Agent API 失败/未完成结果、MCP 失败/未完成结果、CLI 帮助/失败/未完成结果，以及当前开发与交接入口。37 个原工具及 2 个 Agent 工具的描述和参数保持不变。

规则源文件：src/pro/ai-recovery.cjs。文档使用 scripts/sync-ai-recovery.cjs 同步。错误结果保留原 code、state、任务 ID、isError 语义并附加 recovery；不把连接失败伪装成执行成功。

## 恢复步骤

1. 保存原目标及连接、操作、会话请求和传输 ID。
2. 自动查询原连接任务或连接状态；需要连接时使用已记住设备，不能反复配对或重置身份。
3. 每次等待超时后继续查询/恢复；持续退避，不能因达到次数就停下、报告断线并交给用户。
4. 连接恢复后核验同一目标，先查询原任务结果，再继续剩余工作。原结果未知不能重放副作用。
5. 会话丢失时核查实际效果和上下文后推进剩余任务；不得冒称原 shell 存活。旧协议同样要重连并核查实际效果。
6. 用户明确停止与授权撤销继续有效；连接恢复不创建新授权。

## 交付边界

本次修改 AI 可见的恢复规则和返回提示，不增加业务命令的自动重放，不重构已有 Agent/transport 自动恢复状态机。提示覆盖与模型实际遵守率分别验收；静态覆盖不能证明模型行为百分之百成功。历史运行包不因源码更新而视为已经升级。

## 测试清理

按用户要求删除所有项目自有测试及夹具、测试专用脚本、测试 npm 命令、测试工作流和测试报告，不再新增或运行测试。打包发布流程移除已删除的测试脚本调用。
