# SSH Relay 端到端整合技术方案

日期：2026-10-19。状态：拟实施设计，接口及新文件尚未实现。一端可同时连接 1～5 台不同目标主机，每台独立配对、认证、执行和恢复。保留原有 37 个工具的能力；允许一份简单接入 skill，不再用 skill 实现连接、恢复或故障排查。

## 优先约束：原 MCP 和工具尽可能原样保留

这次是把现有软件接起来，不是重写 MCP：
- 原 37 个工具名、schema、server 参数、默认值、主要返回结构和 handlers 尽可能保留。
- 一端最多五台，继续通过原 server/组参数指定目标，不新增所有工具必填的 deviceId。
- 不用通用 invoke 工具替换原工具，不整体迁移 handlers 到 Agent。
- 配对入口确实缺失时才少量新增工具；现有 ssh_list_servers 直接接入设备列表。
- 旧 --connection/--connections 模式继续兼容，新模式自动发现同账户 Agent。
- 简单 skill 只说明入口，不负责内部恢复。持久任务/续传在原接口后渐进实现。
- 原有业务逻辑先保留，主要改 config provider、transport 连接入口与 Agent API。

## 0. 固定拓扑：一端同时连接最多五台主机

这是本方案的基本要求，不是后续扩展。一个近端安装实例服务一个用户，可同时保有最多五个目标主机连接；不是一个主机只能选另一个主机，也不是全局只能有一个活动目标。

```text
                         ┌─ 主机 A：独立身份 / worker / SSH / 任务
                         ├─ 主机 B：独立身份 / worker / SSH / 任务
AI → MCP/CLI → 近端 Agent ├─ 主机 C：独立身份 / worker / SSH / 任务
                         ├─ 主机 D：独立身份 / worker / SSH / 任务
                         └─ 主机 E：独立身份 / worker / SSH / 任务
```

目标不绑定固定五台机器：可以断开其中一台，再连接另一台。每台受支持且已安装、运行本项目远端 Agent 的 Windows/Linux 主机，均可独立配对；“任何主机”不意味着能无授权连接裸系统、绕过网络政策，或已支持未实现的操作系统。

### 0.1 额度与设备记忆

- 最多同时启用五个目标连接槽位；已记住的离线设备记录可超过五条。
- 连接中、已连接、自动恢复中、等待该目标控制权审批的设备都占一个槽位，避免断线后偷偷挤入第六台。
- 同一 deviceId 重复 connect 复用槽位、readyPromise 和连接，不重复计数。
- 主动 disconnect 取消该设备恢复并释放槽位，保留配对。之后连接其他主机无需删除原设备。
- 新连接需要第六个槽位时返回 DEVICE_LIMIT_REACHED 和已占用设备列表；不自动踢掉任一设备，不替用户选择要断开谁。
- 新码指向未配对设备时，在进入配对前预留槽位；失败/过期释放，配对成功后原子转为设备槽位。同设备并发配对完成后合并槽位。
- maxActiveDevices=5 是近端服务强制限制，不能只在 MCP 或 GUI 隐藏按钮。所有入口共用一个锁/队列执行槽位变更。

devices.json 持久化 desiredConnected；服务重启按该集合恢复最多五台。旧配置超过五台时保留所有配对，先恢复明确标记优先级的五台，其余标记 suspended_limit 并返回说明，不删除授权。

### 0.2 五台的隔离和并行

ConnectionBroker 用 Map<deviceId, DeviceRuntime> 管理，不能用单一 currentConnection/currentDevice。每个 DeviceRuntime 独立维护 generation、worker、SSH、恢复 timer、请求队列和通道额度。

所有单机业务请求必须绑定 deviceId；多机操作显式传 deviceIds（最多五个）并返回逐机结果。工具旧 server 别名必须解析到固定 UUID，批量执行禁止通过修改全局默认设备轮流调用。

组操作在父 operation 下为每台创建 child operation；一台失败不重跑其他已成功主机。取消整组逐一报告结果，不能把一台失败当作五台全部失败。

连接建立默认并行度 2，避免一次启动过多握手；建立后五台可以同时在线、并行操作。各设备命令默认并发 2，控制查询预留通道，实际 SSH/relay 通道上限按协商能力限制，不把“五台主机”误当“五条 SSH stream”。

在读到的现有实现中可靠传输有通道容量限制；实施时核对它是每 relay 实例还是共享资源。每台分配独立 worker/session 状态；若某中继资源共用，必须加全局公平队列，容量不足只返回该操作排队/容量状态，不关闭其他主机。

### 0.3 与远端控制权审批的关系

五台连接额度控制的是“本端连多少台不同主机”；现有 Admission 控制的是“同一目标由哪个控制方操作”。两者不能混淆。

同一近端连接 A、B、C、D、E 各台的 Agent，互不争用控制权。不允许用一份全局 ownerId 限制所有目标，只能在各远端独立判断。

若其他近端正在控制其中某台，只有那台进入等待审批；另外四台继续操作。本次仍保留每目标现有控制策略，不把它当成一端只能连一台的理由。

## 1. 现有代码的问题与改造决定

以下关键调用已对照 fix/ssh-pro-startup-20261019 分支源码；其他业务模块结合当前工作区检查，实施时须对最终基线复核。

| 现状 | 具体改造 |
|---|---|
| pro/agent.cjs 已提供 /pair/create、/pair/connect、/status、/device、/unpair，并维护 targets、probe、tick | 以 Agent 为连接权威，新增设备 API 与任务 API，不再写一套连接系统 |
| Agent 有探测 SSH，MCP transport 有业务 SSH 和恢复循环 | 保留业务连接池；Agent 管设备/worker/relay 恢复，transport 建连前查询 Agent，不再拥有独立后台恢复。两类 SSH 可以并存，避免为合并连接重写工具 |
| mcp/config.js 要求外部传 --connection 报告路径，读取 runtime.json、peer.json 和私钥 | 托管模式改为调用 Agent；报告仅作内部兼容输出，正常使用不再传路径 |
| MCP handlers 已实现全部业务工具 | 保留执行位置和调用关系，在 config/transport 接入 AgentProvider，不整体迁移业务引擎 |
| remote.cjs 在 SSH stream close 时终止对应命令进程 | 增加远端任务管理和结果存储；任务生命周期与 SSH 通道分离 |
| 最新分支已有 Admission、remote_busy、控制权切换审批 | 保留该语义；同一控制方复用连接，其他控制方进入审批，不自动抢占 |
| CLI、GUI 各自组织服务启动与请求 | 提取同一 SDK，由 CLI、MCP、GUI 共用 |

不替换现有 OPAQUE、SSH 和 MQTT 可靠传输协议。先补齐应用层整合与任务语义，避免连传输层一起重写。

## 2. 最小改动调用链

```text
AI → 原 MCP server → 原 catalog / handlers
                              ↓
                  原 config + AgentProvider
                              ↓
                  原 transport + AgentClient
                     ├─ ensureReady → Agent → 原 worker/relay/恢复
                     └─ 原 SSH 业务连接池 → near/MQTT/far
                                                ↓
                                        原 exec/shell/sftp
                                        + 后续任务 subsystem
```

MCP 保留业务执行，Agent 提供设备发现、配对、连接就绪与设备级恢复。原文件路径仍指 MCP server 所在机器。MCP 退出关闭自己的连接，不关闭设备 Agent；不能把未来独立任务随适配器退出杀死。

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
| GET /v1/devices | 无 | 设备 ID、名称、状态、能力、槽位使用情况 |
| GET /v1/devices/:id/connection | 无 | 仅本机适配器读取的已验证连接描述符 |
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

connect 最多同步等待 20 秒，之后返回连接任务 ID。原业务工具继续由原 MCP handler 执行，保持现有等待和返回约定；新增持久任务按需提供兼容查询扩展。

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

1. SDK ensureAgent；Agent 校验 requestId，code 与 deviceId 二选一；按第 0 节原子获取/复用连接槽位，超过五台拒绝。
2. 有码时调用现有 joinPair；验证 safeInfo；原子保存授权材料并取得现有 UUID。
3. 对设备调用 ensureReady(deviceId, deadline)；相同设备的并发调用共享 readyPromise。
4. 由 tick 启动/复用 near worker，等待新鲜 peer 状态与协议能力。
5. 处理 Admission：remote_busy 是等待控制权，不是认证损坏；不能不断生成审批请求。
6. 用固定主机密钥认证 SSH，执行现有真实账户/主机探测；检查返回数据完整性。
7. 查询 control subsystem 的 capabilities，返回 ready 和实际能力。
8. 调用超时则返回 connectionTaskId；不清掉已完成的配对。

连接码仍用现有 OPAQUE 格式，第一阶段不改码长/协议。每设备持久保存预期主机密钥；主机名仅展示，不能替代密钥身份。账户变化作为权限上下文变化处理，不自行把新账户当成原授权范围。

### 4.3 保留业务连接，接入 Agent 就绪能力

SDK 增加 ensureReady(deviceId) 与 getConnection(deviceId)。内部描述符：

```js
{ deviceId, generation, host:"127.0.0.1", port, keyPath, fingerprint,
  platform, remoteUser, hostname, capabilities, permissions }
```

该描述符只通过本机认证 API 提供适配器，私密路径不返回 AI、不进入普通日志。复用现有报告作为兼容产物，新模式不用外部指定报告。

transport.connect(server) 只做这些改动：
1. 通过 provider 将原 server 名解析为固定设备 UUID。
2. 等待 Agent.ensureReady，获取新描述符并转换成原 config 对象。
3. 复用现有 pool/pending、主机密钥校验与真实账户探测；generation/端口变化时更新业务连接。
4. 返回原 conn/client/sftp 接口，原 handlers 不用改成 RPC。
5. recoverManaged 改为向 Agent 报告状态、等待统一设备恢复，不另起无限退避循环。已发出业务不能因此重放。

Agent 管 worker/relay；MCP 管自己的业务 SSH。一个业务错误不等于 worker 故障，不能自动重启整机连接。旧 conn.close 和 sync 超时行为检查影响范围，确保不能关闭其他主机。别名归一化后同设备共享连接键，展示名称和调用参数保留。

## 5. 原 MCP 和工具怎样接线

### 5.1 config provider：主要修改点

保留 servers()/serverConfig() 形状，新增两种 provider：
- legacy：有 --connection/--connections 时继续读原报告，旧配置正常使用。
- agent：无旧报告参数时发现本机 Agent，devices 转换为原 server 配置。

新增 server-bindings.json 保存原 server 名到现有设备 UUID 的绑定，不能以主机名作为密钥身份：

```json
{"schemaVersion":1,"servers":{"office":{"deviceId":"UUID-A"},"server-b":{"deviceId":"UUID-B"}}}
```

既有别名/组/profile 不迁移、不覆盖；冲突返回错误。新设备名必须稳定且符合原校验，不能每次在线顺序变化就换编号。

原 config 是同步函数：provider 启动加载快照，每次工具 invoke 前异步 refresh/ensureReady；再让原 handler 读取本请求不可变快照。用显式上下文或 AsyncLocalStorage 隔离五台并发，不改全局默认主机。离线设备也列出状态，不能因报告未生成而消失。

### 5.2 保留原工具调用

server.js 保留 SDK 注册与 MCP 结果封装，catalog.js 保留原 schema。handlers.js 继续调用 transport/files/jobs/sessions，不整体搬到 Agent。

仍然用 ssh_execute(server, command)、ssh_upload(server, localPath, remotePath) 等既有调用；不得给全部工具强加 deviceId 必填参数，不改成一套 connect/exec/files 新工具名。原成功结果保留，新增字段可选。真正失败或结果未知必须如实表达，不能为了兼容谎报成功。

配置类工具（别名、组、profile、hooks、历史）保持原有状态归属和行为，第一阶段不迁移数据库/目录。

### 5.3 只补缺少的入口

首次配对没有 MCP 入口时增加 ssh_connect(code 或 server)。原 ssh_list_servers 继续列设备，状态工具沿用既有入口；持久任务完成后按需增加 ssh_operation_status(operationId)。

只有一个 MCP server，不为五台目标各注册一份。没有原生 MCP 接入的 harness 可用 SDK 客户端调用原工具；可选薄 CLI 提供 call <原工具名> --args-stdin，共用工具 schema，不另外实现一套业务。

### 5.4 文件路径与后续增强

localPath 仍指 MCP server 所在执行环境，remotePath 指指定 server。第一阶段原 files.js 继续在 MCP 进程读取本地文件并传输，Agent 不接管这些业务参数。后续内部实现续传/任务查询，也不改变原工具的路径参数。

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

- 同一 controllerId 的 Agent 探测与 MCP 业务连接可以并存，Admission 应识别同一控制方；不为强制合并 SSH 重写原工具。
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
先 ssh_list_servers；首次配对用新增 ssh_connect，一端最多同时连五台。
原工具继续用原 server 参数指定目标，不能猜主机。
支持持久任务的工具返回 operationId 时，用状态工具查询；软件负责连接和内部恢复。
连接工具不可见时，用包内 relay-cli 的同等入口，参数从 stdin 传入。
远端明确要求开机、授权或升级时，向用户说明最小动作。
```

简单 skill 解决“入口在哪里、调用什么”，不承担连接状态机。MCP/CLI 的 schema 和 --help 足以单独完成流程，skill 只是便利入口。

## 10. 最小修改清单

| 文件 | 修改 | 保留 |
|---|---|---|
| pro/agent-client.cjs（新增） | 提取 ensure/request，增加设备就绪/描述符查询 | 现有启动、锁和认证 |
| pro/agent.cjs | 设备 API、generation、readyPromise、五台槽位 | 配对、tick/probe、worker、Admission |
| mcp/agent-provider.js（新增） | devices 转原 config，稳定别名映射 | 原 server 参数 |
| mcp/config.js | legacy/agent provider 分流 | 原 config 接口 |
| mcp/transport.js | 建连前查询 Agent，去除重复后台恢复 | 原池、验证、执行和 SFTP 接口 |
| mcp/server.js | invoke 前准备目标、少量新增连接入口 | SDK、注册、结果封装 |
| catalog.js、handlers.js | 非必要不改；确需扩展时字段可选 | 原 37 工具和业务逻辑 |
| remote.cjs、tasks/runner（后续） | 加控制 subsystem 与任务结果记录 | 原 exec/shell/sftp 兼容路径 |
| files/jobs/sessions（后续） | 内部接恢复能力 | 原工具调用方式 |
| desktop/main.cjs | 共用 SDK | 界面与审批 |

第一阶段不新增 business-engine.js，不整体迁移 handlers，不强制所有业务走 /v1/invoke。

## 11. 实施顺序

第一步：SDK + AgentProvider + 五设备槽位管理，在原 config/transport 接通 Agent；先保持原 MCP 与工具调用方式，打通“码 → 原 server → 原工具”。尚不宣称新增持久任务保证。

第二步：control subsystem + TaskManager + runner，先打通 exec 的 submit/get/cancel，再把副作用业务和会话逐项接入；每项标记实际支持的恢复能力。

第三步：文件快照、块确认、完整校验、提交与清理；最后验证业务编排中的中断和阶段恢复。

第四步：保留简单 skill，撤下手工管理连接的要求；对最终下载包做 Windows/Linux 实测，不能用本地 MCP 工具发现替代远端操作。

最终交付行为：用户给码或设备，AI 调用工具；两端程序自动组织内部流程。能恢复的自行恢复，涉及新授权或无法确定的业务结果准确上报，内部操作步骤不再交给 AI 执行。
