# SSH Relay 端到端整合技术方案

日期：2026-10-19。状态：拟实施设计，接口及新文件尚未实现。保留原有 37 个工具的能力；允许一份简单接入 skill，不再用 skill 实现连接、恢复或故障排查。

## 1. 现有代码的问题与改造决定

以下关键调用已对照 fix/ssh-pro-startup-20261019 分支源码；其他业务模块结合当前工作区检查，实施时须对最终基线复核。

| 现状 | 具体改造 |
|---|---|
| pro/agent.cjs 已提供 /pair/create、/pair/connect、/status、/device、/unpair，并维护 targets、probe、tick | 以 Agent 为连接权威，新增设备 API 与任务 API，不再写一套连接系统 |
| Agent 已用 ssh2.Client 建立探测连接；mcp/transport.js 又自行建立连接、维护 pool/pending/recovery | 业务连接统一复用 Agent 的已验证 SSH Client；MCP 不再持有连接或执行恢复循环 |
| mcp/config.js 要求外部传 --connection 报告路径，读取 runtime.json、peer.json 和私钥 | 托管模式改为调用 Agent；报告仅作内部兼容输出，正常使用不再传路径 |
| MCP handlers 已实现原有工具，但直接 import transport/config/files/jobs 等 | 保留 handlers，整体放到 Agent 内的业务引擎执行；MCP 只做代理 |
| remote.cjs 在 SSH stream close 时终止对应命令进程 | 增加远端任务管理和结果存储；任务生命周期与 SSH 通道分离 |
| 最新分支已有 Admission、remote_busy、控制权切换审批 | 保留该语义；同一控制方复用连接，其他控制方进入审批，不自动抢占 |
| CLI、GUI 各自组织服务启动与请求 | 提取同一 SDK，由 CLI、MCP、GUI 共用 |

不替换现有 OPAQUE、SSH 和 MQTT 可靠传输协议。先补齐应用层整合与任务语义，避免连传输层一起重写。

## 2. 最终调用链

```text
AI
 ├─ 已接入 MCP → src/mcp.cjs → agent-client.cjs
 └─ shell      → relay-cli   → agent-client.cjs
                                       │ 本机回环 HTTP + Bearer
                                       ▼
                        近端 Agent（唯一连接管理者）
                        ├─ DeviceManager / ensureReady
                        ├─ BusinessEngine / 原 37 个 handlers
                        ├─ OperationStore
                        └─ targets[deviceId].client：已验证 SSH
                                       │
                        near worker → MQTT → far worker
                                       │
                        SSH relay-control-v1 subsystem（新增）
                                       │ 已认证 controllerId + 进程 IPC
                                       ▼
                             远端 Agent / TaskManager
                             ├─ OperationStore
                             ├─ 独立任务 runner
                             └─ 原有远端作业、Shell、SFTP
```

远端 GUI 启动原 guardian → Agent → worker，不需要安装 Codex CLI，也不要求用户操作自定义 CLI。无桌面部署仍可使用项目自己的启动入口。

MCP stdio 退出只结束适配器，不关闭设备服务和远端任务。用户明确停止软件或撤销授权时再执行对应停止策略。

## 3. 本机服务入口：复用 HTTP，不再让 AI 找文件

### 3.1 提取 agent-client.cjs

从 pro/cli.cjs 提取 request/ensure，作为唯一启动与发现实现：

```js
ensureAgent({ role: "near", profileDir }) -> Promise<AgentClient>
AgentClient.request(method, path, json, { timeoutMs, signal })
```

内部使用现有默认目录 ~/.ssh-relay-pro/near；GUI 的 profile-dir 和 CLI 的 state-dir 在 SDK 内归一化。自定义目录是安装/配置事项，不是每次 AI 调用的参数。

发现流程：读 agent-runtime.json → 认证 GET /v1/health → 核对 apiVersion、role、profileId；没有就绪服务时复用 guardian 锁启动并等待，不能仅凭 PID/端口认定可用。guardian 与 Agent 的现有锁保留，补启动并发测试。

保留现有 127.0.0.1 随机端口、随机 Bearer token、拒绝 Origin 和常量时间比较。HTTP 请求 token 只在 SDK 内读取，不返回 AI；运行文件及目录按当前用户隔离，Windows 补明确 ACL 检查。重连只在读取/幂等请求上安全重试，不能把未知结果的 POST 换一个 ID 再发。

### 3.2 新 API 契约

| API | 请求 | 响应 |
|---|---|---|
| GET /v1/health | 无 | apiVersion、profileId、bootId、role |
| POST /v1/connections | requestId、code 或 deviceId、waitMs | connectionTaskId、deviceId、state、verifiedIdentity |
| GET /v1/connections/:id | 无 | 当前阶段、最终结果或错误 |
| GET /v1/devices | 无 | 设备 ID、名称、状态、能力 |
| POST /v1/invoke | requestId、deviceId、tool、args、waitMs | 已完成结果或 operationId |
| GET /v1/operations/:id | stdoutOffset、stderrOffset、limitBytes | 状态、结果、下一偏移 |
| POST /v1/operations/:id/cancel | requestId | cancel_requested 或最终状态 |
| POST /v1/devices/:id/disconnect | requestId | 暂停自动连接 |
| POST /v1/devices/:id/revoke | requestId | 撤销结果；离线时明确 pending |

保留旧路由用于 GUI 兼容，内部委托新服务。现有约 40 KB 请求体上限保留；连接码与普通工具参数走 JSON，大文件不塞进 HTTP JSON。输出分页默认 64 KiB/流/次；超过限额返回偏移，适配器不能一次加载全部日志。

通用响应：

```json
{
  "ok": true,
  "state": "running",
  "deviceId": "原有 UUID",
  "operationId": "UUID",
  "phase": "executing",
  "retryAfterMs": 1000
}
```

错误结构为 {ok:false,error:{code,phase,message,retryable},operationId?}。HTTP 202 表示仍在处理，400 参数错误、403 权限、409 ID 内容冲突、503 临时不可用；SDK 同时读取结构化 code，不能将所有非 200 都当作启动失败。

connect 和 invoke 最多同步等待 20 秒，之后返回任务 ID；服务继续处理。AI 查询任务即可，不负责执行恢复步骤。

## 4. 设备状态、配对和唯一连接

### 4.1 数据不迁移，增加版本字段

保留现有 near/devices/<UUID>/ 与 far/ 目录，避免破坏已有配对：

```text
near/
  identity.json、near-identity-key.json、devices.json   # 复用
  devices/<deviceId>/
    identity.json、client_key、known_hosts              # 复用
    runtime.json、peer.json、connection.json             # 内部/旧版兼容
  operations/<operationId>/                            # 新增近端操作记录
far/
  far/host_key、connection-private.json、authorized-clients.json
  operations/<operationId>/                            # 新增远端权威记录
```

devices.json 为每设备增加 schemaVersion、autoConnect、permissionSnapshot、lastVerifiedAt。保存密钥与授权的原始文件路径不暴露给 MCP。JSON 单文件继续使用 store.write 的临时写+rename；跨文件配对使用 staging 目录和 commit 标记，启动时识别未提交事务，不能把半写注册当作成功。

内存目标新增 generation、readyPromise、lastErrorCode。每次 worker/SSH Client 替换时 generation++；探测回调只在 capturedGeneration === currentGeneration 时更新状态，防止旧回调污染新连接。

### 4.2 connect 实现顺序

1. SDK ensureAgent；Agent 校验 requestId，code 与 deviceId 二选一。
2. 有码时调用现有 joinPair；验证 safeInfo；原子保存授权材料并取得现有 UUID。
3. 对设备调用 ensureReady(deviceId, deadline)；相同设备的并发调用共享 readyPromise。
4. 由 tick 启动/复用 near worker，等待新鲜 peer 状态与协议能力。
5. 处理 Admission：remote_busy 是等待控制权，不是认证损坏；不能不断生成审批请求。
6. 用固定主机密钥认证 SSH，执行现有真实账户/主机探测；检查返回数据完整性。
7. 查询 control subsystem 的 capabilities，返回 ready 和实际能力。
8. 调用超时则返回 connectionTaskId；不清掉已完成的配对。

连接码仍用现有 OPAQUE 格式，第一阶段不改码长/协议。每设备持久保存预期主机密钥；主机名仅展示，不能替代密钥身份。账户变化作为权限上下文变化处理，不自行把新账户当成原授权范围。

### 4.3 一处管理连接与恢复

新增 ConnectionBroker：

```js
ensureReady(deviceId, { deadline, signal }) -> VerifiedHandle
withConnection(deviceId, fn) -> fn({ client, generation, identity, capabilities })
pause(deviceId)
invalidate(deviceId, { generation, code })
```

句柄仅在 Agent 进程内部使用，不能序列化 SSH 对象给 MCP。withConnection 不自动重新执行 fn；只允许在执行前恢复连接。连接中途失败交给操作协议查询结果。

transport.js 的 connect 在托管引擎中改为 broker 适配器；不再 new Client，不再执行 recoverManaged。pool 作为对现有 handlers 的兼容视图，close 变为释放该工具通道/租约；禁止单个工具 timeout 关闭共享 SSH Client，影响其他工具。需要断开整个设备必须走 Broker 明确方法。

已有 sync 超时等调用 conn.close 的位置逐一改为取消自己的 channel/operation。隧道、SFTP、session 各自登记句柄并在 generation 失效时转换为准确状态。

失败分类改为代码而非仅正则判断：WORKER_NOT_READY、RELAY_OFFLINE、PEER_STALE 可恢复；REMOTE_BUSY 等审批；IDENTITY_MISMATCH、AUTH_REVOKED 停止业务恢复。普通 AUTH_FAILED 先识别 Admission 和授权状态，不能一律索要新码。

继续使用现有 retryDelay，叠加 ±20% 抖动，每设备只有一个 timer/inflight；guardian 管 Agent 进程、Agent 管 worker 和 SSH、relay 管底层消息重传，各层不重复重启对方。

## 5. MCP 和原有工具如何接入，不重写 37 个工具

### 5.1 把业务执行从 MCP server 移进 Agent

新增 business-engine.js，动态加载现有 handlers.js；server.js 保留工具 schema 和 MCP 结果封装，回调改为 AgentClient.invoke。Agent /v1/invoke 按固定 catalog 白名单分发，不能 import 用户提供的模块名。

handlers/config/transport 当前有静态 import。通过显式初始化函数安装 provider，而不是靠启动命令行和全局 process.argv 推断：

```js
initializeEngine({
  deviceProvider,    // devices / getConfig / resolveAlias
  connectionBroker,
  operationStore,
  callerContext
})
invoke(toolName, normalizedArgs, context)
```

config.js 托管模式改为 provider；旧 --connection 模式单独保留 legacy provider。执行前异步 prepare(deviceId) 刷新能力快照，然后现有同步 serverConfig 读取本次快照；不能全局覆盖默认设备来处理并发请求。

现有 server 参数保持兼容：映射 UUID 或已绑定别名，禁止同时传 deviceId 和冲突 server。新增默认设备只允许显式配置，不能按“第一个在线设备”自动切换目标。

所有原有配置型工具（别名、组、profile、hooks、历史）状态统一归属近端 Agent。MCP 重启不丢失持久配置，不再为每份适配器建立不同状态库。实际命令 hooks 仍受显式启用与原权限控制。

### 5.2 文件本地路径归属

MCP 适配器与近端 Agent 必须在同一执行环境和账户下，localPath 始终指这个环境。MCP 客户端可以在别处，但路径语义不随客户端机器变化。

上传时 Agent 打开本地文件、读 stat 并创建传输任务，HTTP 只传路径和元数据。跨机器 Agent 不接受任意 localPath；该用法需另行提供显式流式上传接口，不能假装路径共享。

### 5.3 无原生 MCP 接入的 harness

同一 CLI 提供：

```sh
relay-cli connect --code-stdin --json
relay-cli call ssh_execute --args-stdin --json
relay-cli operation get <operationId> --json
```

CLI 只调用相同 Agent API，不另建 SSH。参数通过 stdin 传 JSON，敏感内容不拼命令行。MCP 接入配置固定为一个命令，不含连接报告和单设备路径。

## 6. 远端任务协议：解决“断线就杀命令”

### 6.1 在现有 SSH 上新增控制 subsystem

remote.cjs 在 session 上注册 subsystem = relay-control-v1，与既有 exec/shell/sftp 并存。子系统请求必须经过既有 publickey 认证与 Admission；从认证结果保存 controllerId，不能信任请求 JSON 自报身份。

协议为 4 字节大端长度 + UTF-8 JSON，单帧最多 1 MiB，输入队列有字节上限。请求与响应都带 rpcId；同通道允许有限并发，写入遵循 backpressure。读取输出按分页返回，不推送无界 stdout。

```json
{"rpcId":"r1","method":"hello","params":{"protocol":1}}
{"rpcId":"r2","method":"submit","params":{"operationId":"UUID","requestHash":"sha256...","kind":"exec","spec":{"command":"...","shell":"powershell","cwd":"..."}}}
{"rpcId":"r3","method":"get","params":{"operationId":"UUID","stdoutOffset":0,"stderrOffset":0,"limitBytes":65536}}
{"rpcId":"r4","method":"cancel","params":{"operationId":"UUID"}}
```

hello 返回 taskProtocol、durableResults、resumableFiles、sessionResume 和工具能力版本。旧远端没有 subsystem 时返回 UPGRADE_REQUIRED；允许显式旧模式，但必须标记不具备新恢复保证，不悄悄把旧模式称为完整端到端。

worker 将已认证请求通过现有 fork IPC 发给远端 Agent：

```js
{type:"task-rpc", rpcId, controllerId, leaseToken, method, params}
```

Agent 响应带 rpcId；worker 重启后旧 IPC 响应丢弃。接收端 TaskManager 按 controllerId 进行操作所有权和权限检查，每个 get/cancel 都检查授权，不能只检查 submit。IPC 消息不可直接暴露到公网。

### 6.2 任务落盘顺序与执行进程

新增 pro/tasks.cjs 与 pro/task-runner.cjs。TaskManager 在远端 Agent 中，runner 作为独立任务进程，输出直接写受限文件，不经 SSH stream 转发。

```text
operations/<operationId>/
  manifest.json    # owner、requestHash、kind、状态、时间、结果索引
  input.json       # 私密执行参数，执行后按策略清理
  runner.json      # PID、进程启动标识、系统 boot 标识
  stdout.bin
  stderr.bin
  result.json      # 最终退出码、结束时间、结果状态
```

submit 流程：验证授权 → 独占创建操作目录 → 写 accepted → 写 starting → 启动 runner → runner 抢占一次性执行锁 → 写 running → 运行系统 Shell/受控作业 → 刷新输出并原子写 result.json。要宣称跨系统崩溃持久性，关键状态需 fsync，不能把 rename 等同掉电保证。

同一 controllerId+operationId、相同 requestHash 返回原任务；hash 不同返回 REQUEST_CONFLICT。hash 对规范化后的 kind/spec 计算，排除等待时间和网络字段，包含目标设备、执行器和命令参数。敏感请求不公开 hash 或输入文件。

SSH channel close 只取消订阅，不终止任务 runner。Agent 重启扫描 manifest：有 result 则完成；存活 runner 只在系统 boot、进程启动标识与所属路径匹配时接管；starting/running 但无法证明进程与结果时标记 unknown，绝不自动重新 spawn。

这解决网络断线与 worker 重启，不承诺电源故障下任意 Shell 恰好执行一次。Windows 任务是否能跨 Agent 退出存活必须原生测试，若宿主 Job Object 强制终止则明确 unknown，不能用 detached 标志代替证明。

取消按 runner 所属进程树执行：Linux 独立进程组，Windows 使用受控进程树终止；先核对进程身份，禁止只凭旧 PID 杀进程。返回 cancel_requested，确实停止后才返回 cancelled。取消不撤销已发生副作用。

输出默认每任务每流 64 MiB 上限，超限截断并标记 truncated，仍持续 drain 子进程管道避免死锁；结果默认保留 7 天，可配置。活动任务不按时间清理，磁盘不足在启动前拒绝，并记录执行中落盘失败。

### 6.3 原有作业、会话及管理工具

exec/deploy/数据库/备份等有副作用的调用先在近端建立父操作，登记各远端子操作 ID；同一父操作查询既有子操作，不从头再部署。多阶段操作保留阶段结果，不承诺目录部署或数据库导入整体事务回滚。

现有 jobs.js 将已有 jobs/*.cjs 作为受控任务 kind 注册到远端 TaskManager，不再每次组装巨大 node -e 或上传临时脚本；版本能力协商确保作业实现匹配。外部数据库客户端仍是依赖，不能被软件“自动修复”成已有。

session 工具改为远端会话 runner 管理，sessionId 绑定 controllerId，命令序列有请求 ID。若实际会话进程存活则恢复；系统重启后返回 SESSION_LOST。当前无 PTY 的能力限制保留。

隧道保持回环范围；可恢复隧道配置和新建监听，不承诺旧 TCP 流恢复。监控、tail 记录订阅游标；普通查询按工具声明重取。不可恢复的业务对象要明确失效，不能用“软件自行恢复”掩盖语义。

## 7. 文件恢复：对现有 files.js 的具体改法

现有 upload 使用 fastPut 后只比较长度，download 使用 fastGet，不能宣称校验完整或可续传。

新增 file-transfer.cjs，在现有 SFTP 和控制 subsystem 上配合：

1. 近端生成 transferId，登记源设备/目标、规范化路径、大小、mtime 与 SHA-256。源文件复制为受限暂存快照再上传；空间不足则拒绝或让用户明确选择不续传模式，不能边变边传。
2. 远端控制 RPC prepareFile 校验权限和覆盖策略，在目标同一目录创建随机 .relay-part-<id>，返回已有块清单。
3. 分块 1 MiB，通过 SFTP 按 offset 写临时文件；每块远端计算 SHA-256，与声明值一致后提交块清单，丢失确认则重查，不依赖“发送成功”。
4. 中断后读取清单，复验暂存文件身份和已收块，补传缺块。块清单更新与数据落盘顺序保证不能确认尚未稳定保存的数据。
5. commitFile 校验完整 SHA-256，再按 reject/overwrite/rename 策略完成替换；可原子 rename 的平台使用原子提交，不支持时返回实际降级结果。
6. 下载使用近端 .part 和同等清单，远端源变化返回 SOURCE_CHANGED，不拼接两个版本。
7. transfer 状态与 RPC 都绑定 controllerId；清理取消/过期临时文件，默认 24 小时，活动传输不清理。

远端路径保护在 SFTP/文件服务执行端实施，校验符号链接、Windows 重解析点及真实父目录。具有任意 Shell 权限的客户端不宣称被文件目录规则完全隔离。

## 8. 控制权、授权和故障处理

保留最新 Admission 策略，不能未经用户选择改成多方同时控制：

- 同一 controllerId 的 Agent 探测与业务共享 SSH，消除重复占用。
- 不同 controller 请求控制时，沿用远端已有审批；pending 返回 WAITING_APPROVAL，AI 不负责操作内部 admission。
- 切换控制权时新操作被拒绝或排队；旧操作按现有 drain 语义处理，状态可查询。审批是用户授权，不得由自动恢复擅自批准。
- 撤销时立即阻断该 controller 的新操作、关闭通道，默认取消该 controller 活动任务；取消是否成功逐项记录。
- 近端删除记录不等于远端撤销；远端不可达返回 revocation_pending。

恢复动作由错误码驱动：

| 条件 | 动作 |
|---|---|
| runtime 无效/本机服务未就绪 | SDK 检查旧进程归属，复用 guardian 或安全启动 |
| near/far worker 退出 | Agent 按 retryDelay 重启自己的 worker |
| peer 心跳过期/网络断开 | 等待底层恢复；不删除密钥、不重新配对 |
| 已验证连接断开 | Broker 重建，generation++；对任务执行 get，不重发 submit 为新 ID |
| REMOTE_BUSY | 等待既有审批结果，不并发刷控制请求 |
| IDENTITY_MISMATCH/AUTH_REVOKED | 停止业务并明确报错，不关闭校验 |
| 缺运行依赖/账户无权限 | 返回具体依赖/权限，不能自动安装全局软件或提权 |
| 操作记录损坏 | 隔离坏记录，返回 unknown；身份库损坏绝不猜测重建身份 |

## 9. 简单 skill：允许保留，限定为接入说明

建议保留如下短 skill，不写日志路径、重试算法和角色配置：

```text
使用已配置的 SSH Relay MCP。
先 devices；首次配对用 connect(code)，已有设备用 connect(deviceId)。
原有工具指定返回的设备，不能猜目标。
返回 operationId 时用 operation_status 查询；软件负责连接和内部恢复。
连接工具不可见时，用包内 relay-cli 的同等入口，参数从 stdin 传入。
远端明确要求开机、授权或升级时，向用户说明最小动作。
```

简单 skill 解决“入口在哪里、调用什么”，不承担连接状态机。MCP/CLI 的 schema 和 --help 足以单独完成流程，skill 只是便利入口。

## 10. 按文件实施与检查

| 文件/新增模块 | 必须完成的改动 | 最小验证 |
|---|---|---|
| pro/agent-client.cjs（新增） | 提取 ensure/request，apiVersion、202、超时、幂等规则 | 并发启动只有一个 Agent；POST 响应丢失不重复业务 |
| pro/agent.cjs | 新 API、generation、readyPromise、Broker 与引擎初始化 | 配对后无需路径即可 invoke；旧探测不能覆盖新状态 |
| pro/connection-broker.cjs（新增） | 管已验证 SSH Client，通道租约与唯一恢复循环 | MCP/GUI/CLI 同时调用不重复连接、不互相 close |
| mcp/config.js、transport.js | provider 注入；移除托管恢复与二次 SSH | 不传 --connection 仍能用全部既有工具 |
| mcp/server.js、cli.cjs | 薄适配，connect/devices/status；业务转发 | 原生 MCP 与 CLI 相同请求得到等价结果 |
| mcp/handlers.js、business-engine.js | 保留工具，绑定 request/device/context；拆近端编排和远端动作 | 37 工具能力清单逐项对照，依赖失败如实返回 |
| remote.cjs、control-protocol.cjs | subsystem、限帧、认证 controller、IPC | 越权 get/cancel 被拒绝；错帧不拖垮服务 |
| pro/tasks.cjs、task-runner.cjs | 落盘、去重、脱离 channel 的执行、查询取消 | 提交/确认/结果各阶段断线与进程崩溃注入 |
| mcp/jobs.js、sessions.js、files.js | 任务化、会话 runner、分块校验与提交 | 非幂等动作不重放；续传结果 SHA-256 一致 |
| desktop/main.cjs | 使用 SDK，保留生成码和控制权审批 | 远端全程无需 CLI，审批行为不退化 |
| 简单 skill / README | 只保留最小入口，删除内部手工恢复要求 | 不读长文也能完成首次连接和实际任务 |

## 11. 实施顺序与验收线

第一步：SDK + Broker + MCP 薄适配，先用已有执行实现打通“码 → 设备 → 原有工具”，明确此时还没有持久任务保证。

第二步：control subsystem + TaskManager + runner，先打通 exec 的 submit/get/cancel，再把副作用业务和会话逐项接入；每项标记实际支持的恢复能力。

第三步：文件快照、块确认、完整校验、提交与清理；最后验证业务编排中的中断和阶段恢复。

第四步：保留简单 skill，撤下手工管理连接的要求；对最终下载包做 Windows/Linux 实测，不能用本地 MCP 工具发现替代远端操作。

验收必须包含：无旧状态首次配对；码过期与重复使用；Agent/MCP/worker 分别重启；提交前后及结果返回前断网；同 ID 冲突；共享通道取消隔离；控制权审批；撤销中执行；文件源变化与损坏块；远端缺依赖；结果未知和磁盘满。每种场景有明确输出，不把“自动恢复”作为空泛通过结论。

最终交付行为：用户给码或设备，AI 调用工具；两端程序自动组织内部流程。能恢复的自行恢复，涉及新授权或无法确定的业务结果准确上报，内部操作步骤不再交给 AI 执行。
