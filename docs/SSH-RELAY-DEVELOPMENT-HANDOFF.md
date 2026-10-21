# SSH Relay 开发交接

日期：2026-10-21（北京时间；保留此前开发记录）
目标分支：`fix/ssh-pro-startup-20261019`
接续基线：`52a58b742f156d2e98a1128bcb243020b299de64`
本轮源码提交号：以本文件所在的 Git 提交为准；下方定时检查点记录上一个提交。

## 本轮授权与进度依据

仅按本交接文档及其本轮更新继续开发，不以较早进度报告推断当前完成状态。用户明确授权源码每五分钟上传一次，无需等待验证；每到上传节点只保存和上传源码、更新交接检查点，不运行验证。本轮不把源码上传等同功能验证或可用运行包交付。

## 目标与设计入口

完整目标与当前文档入口已集中到 [端到端设计文档](SSH-RELAY-END-TO-END-DESIGN.md#完整目标与当前文档入口)。本交接记录实际进度、检查范围和下一步，不替代目标设计。此前环境的自动上传状态不代表本会话；本会话通过 GitHub 插件提交检查点。

## 本轮已实现的源码

1. 已从设计文档第 11 节精确删除「验收线」字样及「五主机专项验收」「验收必须包含」「兼容验收」三个段落，保留其余技术设计。
2. 已新增 `src/pro/device-slots.cjs`，接入 Agent 配对、设备启用、tick 与状态。最多五个已启用设备占位，离线仍保留槽位；重复连接已占位设备不新增槽位；旧数据溢出按配对时间及设备 ID 稳定选择前五台，超出部分显示 `slot_paused`、不启动连接，配对数据不删除。停用或取消配对后释放槽位。
3. 已抽取 `src/pro/agent-client.cjs`，CLI 保留原 `request/ensure` 导出；共享客户端仅请求 loopback，校验端口与令牌格式，限制响应大小，每次请求重新读取本地 Agent 运行信息。
4. 已新增 `src/mcp/agent-provider.js`。MCP 使用 `--agent-dir <near状态目录>` 经同一认证 `/status` API 发现在线设备；保留原 `--connection` 与 `--connections` 路径，三种模式互斥。新模式使用稳定名称 `device-<设备ID>`，每次工具调用与新建连接前刷新。Agent API 失败时清空发现快照，不沿用旧目标。原报告身份核验和 SSH 主机指纹校验继续执行。

## 已上传与定时保存

- 首次交接检查点 `64415d54b683c5f0882c31ea772bf03067ec6259` 已推送并核对远端，本轮 GitHub 写入已恢复；上一轮受阻记录不再作为当前写入阻塞。
- 修改前备份：`/workspace/xxm/beifen/ssh-relay-pro/ssh-relay-pro_v20261020_151803_before-change.zip`。
- 上传脚本：`/workspace/xxm/ssh-relay-ops/upload-source.py`；PID 文件：`/workspace/xxm/ssh-relay-ops/uploader.pid`。
- 上传日志：`/workspace/xxm/ssh-relay-ops/upload.jsonl`，记录每次实际推送成功的源码提交号或失败原因。推送后只核对远端提交号，不运行源码验证。
- 调度从北京时间 23:18:03 开始，每 300 秒执行一次；允许额外即时保存。开发修改与上传使用同一文件锁避免写入冲突。不配置系统服务或自启动。

## 本轮检查及未覆盖范围

北京时间 23:21:19 在两个上传节点之间执行 `node --test tests/pro/device-slots.cjs tests/pro/agent-client.cjs tests/pro/mcp-agent-provider.cjs`：4 项通过。覆盖槽位满额与释放、重复占位、旧数据溢出与重启一致性、共享 API 令牌轮换与错误拒绝、MCP 在线发现及旧报告路径读取。

这些是使用临时目录和本机模拟 API 的检查，未连接任何用户电脑，不能代替 Agent 实际多设备连接、端到端 MCP 工具调用或平台验收。未安装依赖、未更改系统环境或权限、未构建新运行包；上传不以这些检查通过为前提。

## 本轮形式化检查（2026-10-20，北京时间 23:30）

当时的形式化检查仅覆盖五设备槽位及认证 Agent 异步发现，不代表设计文档中的完整目标或完整业务流程已经证明。

- 可复现检查器：`scripts/formal-relay.mjs`；原说明已按本次清理要求移除，历史结果摘要保留如下。
- 对生产槽位代码穷举七设备 2187 个状态、45927 个迁移；对生产异步发现代码穷举三请求 15 种交错、失败与内容组合共 960 个场景，所列安全不变量通过。
- 找到原发现实现的并发反例：较早的响应覆盖较新的停用列表。已在 `agent-provider.js` 增加代次检查并由 `config.js` 接入，过期响应拒绝发布。旧实现的反例检查确认能够检出该缺陷。
- 修复后重新执行本轮 4 项局部回归检查，通过。检查均在上传节点之外运行。
- 这是有界检查与抽象不变量论证，不是全系统证明。真实 worker/SSH 生命周期、报告文件竞态、业务执行时的原子撤销和活性未证明，仍需后续工作。

## 文档清理后的已知引用

本次只清理文档和交付物，未修改应用代码。`src/mcp/prompts.js` 的手册资源仍读取已删除的 `docs/MCP-MANUAL.md`；`scripts/package-pro.py` 仍复制已删除的 README/AGENTS/许可证文件。相关资源调用或打包会受影响，下一轮开发需处理；不声称清理后已通过运行验证。原打包脚本还会重新创建 deliverables/ 输出目录，本次未运行这些脚本。

## 下一次继续开发的位置

1. 对上述源码进行 Agent 生命周期集成检查：实际配对/启用路径拒绝第六台、五台分别恢复、旧数据溢出停用及释放后恢复、进行中连接取消和槽位状态一致性。
2. 验证 Agent 模式下完整 MCP 工具调用、别名/profile 兼容、后台重启后端口更新与连接恢复；原 `--connection` 路径的完整工具回归尚未执行。
3. 当前 Agent 发现仅枚举已启用且在线、已有身份核验报告的设备；离线与尚未首次核验的设备不列为可用服务器。后续若需列表展示离线设备，应显式增加状态语义，不能把它们显示为可用连接。
4. 继续保持五分钟源码上传与本交接更新。不得把上述待办或源码实现写成已经通过实机验证。

## 运行边界

定时进程仅在本云端执行环境及进程存活期间有效；环境停止、认证失效或网络故障可能中断上传。失败记为失败，本地提交不能代替远端保存。只上传项目源码和必要清单、说明、检查源码；不上传密钥、配对码、连接报告、运行状态、原始日志、依赖目录或新运行包。

<!-- periodic-source-upload -->

## 定时源码上传检查点

- 上传准备时间（北京时间）：2026-10-20T23:38:03+08:00
- 上一个本地提交：`e294803d177c8460186f2405b04635b3197e5553`。
- 本检查点仅保存源码；用户特许不经验证上传，不代表功能或交付验收通过。
- 本次推送结果见工作区 `/workspace/xxm/ssh-relay-ops/upload.jsonl`；文档写入早于推送，不能单凭本段判断推送成功。

## 2026-10-21 共享 SDK 接续（本提交）

依据端到端设计第 3.1 节继续第一阶段：
- agent-client.cjs 接管 guardian 启动及等待；同进程按角色和目录合并并发启动，跨进程继续使用现有 guardian/Agent 锁。
- 新增 ensureAgent 与 stateDirectory，统一默认目录及 profileDir/dir 入口；保留 request/ensure 兼容导出。CLI 与桌面端删除重复启动和 HTTP 代码；桌面 far-state-dir 也用于启动。
- Agent 新增认证 GET /v1/health，运行信息增加 apiVersion/profileId；SDK 核对 API 版本、角色、磁盘身份与运行实例 bootId。已响应但版本/身份不匹配时明确报错，不继续启动其他服务。
- HTTP 客户端接受 2xx（含未来 202）、保留结构化错误 code/phase/retryable，支持请求超时及 AbortSignal；不自动重发 POST。
- 本批仅实现源码，未运行测试、构建、形式化检查或实机连接；上传节点仅上传源码和本交接。旧运行中的 Agent 无 /v1/health 时返回不兼容错误，需要正常停止旧版本后再启动新版，未加入自动杀进程或降级绕过检查。
- 后续仍需：并发启动/端口轮换/错误身份集成检查、Windows ACL 检查、AgentProvider 无参自动发现与 ensureReady、新设备连接 API 和 generation 隔离。五台实机与原工具完整回归仍未完成。
- 本会话无法复用文档记录的旧工作区上传脚本；本检查点通过 GitHub 插件直接更新目标分支，不表示后台定时进程已启动。仅在本会话持续执行期间安排五分钟检查点。

## 2026-10-21 MCP 无参发现接续（本提交）

- 依据设计第 3.1、10、11 节，未传 --connection/--connections 时默认使用近端 Agent；--agent-dir 继续覆盖目录。三种显式入口互斥，并拒绝缺少路径的参数，避免误入自动启动。
- AgentProvider 通过 ensureAgent 共用启动与健康身份核验，再请求认证 /status；不直接绕过 SDK 读取未核验端点。仍只发布已启用、在线且有已验证报告的设备，保留原报告与主机指纹检查。
- 更新局部模拟检查源码以提供 /v1/health 身份，并覆盖默认用户目录发现及旧报告不访问 Agent；本批未运行检查、构建或实机操作，上传无需等待验证。
- 当前仍未实现 ensureReady、连接任务 API、离线设备状态列表及 generation 隔离。现有实现仍依赖内部报告，不能宣称已完成第一阶段。
- 当前环境 Git 镜像克隆缺少认证，已改用用户选定 GitHub 插件原子提交源码及本交接；未启动无人值守上传进程。五分钟检查点仅在本会话持续执行时安排，无法保证环境停止后的上传。

## 2026-10-21 设备连接代次隔离（本提交）

- 按设计第 4.1 节给每个目标添加 generation。worker 创建/退出、停用、重新配对、取消配对和关闭 Agent 时先使旧连接代次失效，再销毁 SSH 客户端，并重置 connecting/probeBusy/probeOwner。
- SSH ready/error/close/超时及周期身份探测回调只可修改同一目标、同一代次、同一客户端。旧身份探测不得写回 connection.json 或清掉新探测标记。
- 修复 worker 退出时残留 connecting/probeBusy 可能阻止下一次连接的问题；保留每设备独立重试与原身份校验。
- 本检查点只上传源码与交接；未运行测试、构建、形式化检查或远端操作。需要继续补充旧回调交错、停用后重启、五设备各自恢复的局部与实机检查。

## 2026-10-21 代次竞态检查源码（本提交）

- 新增 tests/pro/agent-generation.cjs，使用生产 Agent 原型及本地临时目录，构造同步销毁回调、旧身份结果晚到、新探测标记保留、无 child 时停止进行中探测四类断言。
- 这些仅为检查源码，尚未执行；不代表竞态已通过验证。本轮所有新增实现仍需局部检查及 Windows/Linux 实机检查。
- 上一个成功上传提交：75019175e6c8612996b068f2b8d4e87eaeec7414；本文件所在提交包含本检查源码。每次上传通过 GitHub 插件更新目标分支，不存在已配置的后台五分钟上传服务。


## 2026-10-21 00:44（北京时间）源码检查点

- 按设计第 4 节增加逐设备 generation：worker 替换、停用及退出时清空旧探测状态；旧 SSH 的 ready/error/close/身份回调不得覆盖新连接。身份报告绑定实际握手端口。
- 五台槽位增加配对前预留；配对失败释放、成功注册后转为设备槽位，所有旧启用入口也计入预留。新错误码 DEVICE_LIMIT_REACHED 附占用设备列表。
- 新增 connections.cjs，并接入认证 /v1/devices、POST /v1/connections、GET /v1/connections/:id 与 GET /v1/devices/:id/connection。连接 requestId 持久记录输入摘要并拒绝冲突；相同请求查询既有状态；Agent 重启时未终结请求标记 unknown，不自动重放配对。
- 已配对设备启用与原配对路径共用槽位；每设备共享 readyPromise；同步等待上限 20 秒，随后返回 202 与任务 ID；remote_busy 显示 waiting_approval。内部连接描述符不进入普通设备列表。
- SDK 增加绝对请求时限、字节计数及分块缓冲，保留 UTF-8 边界与结构化错误 details。
- 本检查点未运行任何验证、测试或构建；以上是源码变更，不表示集成通过。尚未接入 MCP 无参数发现、设备断开 API、请求快照隔离和稳定名称绑定；这些接着开发。任务日志保留/容量与配对跨文件 staging 事务仍未完成。
- 上一远端提交：7a0e134c9a068d29c91e8b2befe315095722c332；本检查点提交号以所在 Git 提交为准。

- 上传冲突处理：远端同时新增 87b8f775 的 MCP 默认发现源码；本批基于该提交合入并保留其源码和交接记录，未强制覆盖分支。

- 远端又新增 75019175 的 generation 实现，本批以其为基线保留回调修复，仅合入连接任务、预留槽位及握手端口核对。


## 2026-10-21 00:52（北京时间）MCP 接线检查点

- AgentProvider 切换到 /v1/devices 与内部已验证描述符，不再通过 connection.json 为 Agent 模式取配置；旧 --connection/--connections 路径仍保留原读取逻辑。未在线/停用的设备保留在列表且明确状态。
- 每次 MCP 工具调用使用 AsyncLocalStorage 独立设备快照；旧 discovery 的代次检查保留，业务 SSH 另经 ensureReady 获取最新描述符。新增 server-bindings.json 的固定名称到设备 ID 读取，冲突报错，不改原别名、组及 profile 文件。
- SDK 补 devices/connect/connectionTask/getConnection/ensureReady，活跃设备优先读取就绪描述符；同设备并发等待复用 Promise，显式停用设备不会由业务调用偷偷启用。
- 业务池按 Agent bootId、generation、端口和指纹匹配，建连中描述符变化则取消旧握手；旧 close 不得删除新池项，shutdown 取消 pending。Agent 模式不再启动 MCP 自己的后台恢复循环；legacy 模式保留旧行为。
- 在不改原工具 schema 的基础上，新增 ssh_connect，支持 code 或已有 server、requestId 和连接任务查询；配对码从错误结果中脱敏。原列表增加可选 deviceId/state/enabled/lastVerifiedAt。
- 本批未运行检查、测试、构建或远程命令。旧模拟 API 检查源码尚未适配新 /v1/devices/descriptor 契约，不能沿用旧通过结论。仍需继续：幂等 disconnect、CLI stdin 入口、默认连接并行度 2、配对 staging、任务记录容量与清理，以及多机实测。
- 上一成功远端提交：48503e43f4c7d86a5db27830ea0f114848d0bbb9。

## 2026-10-21 00:56（北京时间）断开与 CLI 检查点

- 新增认证 POST /v1/devices/:id/disconnect：保留配对，持久停用 desiredConnected，取消该设备恢复并释放槽位；重复 requestId 返回原结果、不同输入返回 REQUEST_CONFLICT；中断后不盲目重放未知断开结果。
- readiness 使用独立 intentGeneration，主动断开可取消旧等待；worker 自动恢复仍允许同一等待继续。MCP 原 ssh_connection_status 的 disconnect/reconnect 在 Agent 模式同步调用设备 API，退出 MCP 本身仍不停止 Agent。
- CLI 补 connect/disconnect --args-stdin、connection-task --id 与帮助，配对码不要求进入命令行；devices 读取新设备列表。
- 连接请求内存最多 1024 个活动记录，持久记录最多 10000 条；清理超过七天的终结记录，不清理活动请求。Agent 读取 desiredConnected 时兼容旧 enabled 数据，原配对写入 schemaVersion/desiredConnected/autoConnect。SSH 握手默认最多两台并行。
- HTTP JSON 接收改为字节上限与完整 UTF-8 解码；新 API 按冲突/权限/不存在/临时不可用返回结构化状态码。
- 新增 tests/pro/connections.cjs 检查源码，涵盖 requestId 冲突、重启 unknown 不重配对、断开取消和配对预留槽位；本批没有运行这些或其他检查、测试、构建。
- 继续开发配对跨文件 staging/提交恢复；Windows ACL、原模拟 Provider 检查契约更新、多机实测与第二阶段持久业务仍未完成。
- 上一成功远端提交：608ea2a659f669e5760e4af570a7e594c40e094e。

## 2026-10-21 01:00（北京时间）配对事务源码检查点

- 新增 pair-state.cjs：先把身份、客户端密钥和设备记录写入私有 staging，最后写 commit 标记，再安装到原设备目录；Agent 获取自身锁后、启动 HTTP/worker 前恢复已提交事务，删除未提交 staging。损坏的已提交事务停止启动，不猜测身份材料。
- 完成凭据保存在独立 pair-completed 目录，避免部分 staging 清理失败后在用户断开或取消配对后重放旧授权；不把目录 rename 等同系统掉电 fsync 保证。完成凭据清理策略仍待补充。
- 新增配对恢复检查源码，覆盖提交恢复、未提交丢弃、坏密钥拒绝及取消配对后不恢复旧事务；未运行。
- MCP guide 改为从现有 instructions/workflows 源码生成，修复读取已删除 MCP-MANUAL.md 的错误；接入说明移除 AI 手工日志/端口/退避管理步骤，使用 ssh_connect 和状态查询。
- 更新 Provider 模拟检查源码适配 /v1/devices 与内部描述符，并保留离线/槽位暂停设备断言；未运行。源码来源记录新增本轮应用整合模块及改造范围，没有引入新第三方依赖。
- 打包脚本引用已删除 .agents/README/AGENTS/许可证的问题仍待处理；本轮未打包，不能称可用运行包已完成。Windows ACL 检查与端到端实测仍未完成；第二阶段持久业务执行尚未开始。
- 本检查点只保存和上传源码、交接与来源记录，不运行验证。上一成功远端提交：0aab57d9f293dc76c57b8a0e17b3f1de87ad041c。

## 2026-10-21 01:04（北京时间）本机私有状态检查源码检查点

- 新增 private-state.cjs，在 SDK 读取运行令牌及 Agent 启动前检查本机目录/身份/运行文件：Unix 拒绝非当前账户所有、组或其他账户可访问及符号链接的状态路径；Windows 通过系统 PowerShell 读取 ACL，仅接受当前账户、SYSTEM 和 Administrators。检查失败返回 LOCAL_STATE_PERMISSIONS，不自动修改 ACL、继承或提权。
- Agent 身份和设置落盘移至获得 Agent 锁之后，避免未获得锁的重复实例先写身份状态。新增检查源码及私有权限 fixture；本批未运行。
- JSON 请求、stdin 和运行记录损坏时使用固定错误消息，避免解析器把配对输入/本机运行信息片段返回到普通错误输出。
- Windows ACL 仅完成源码，未在 Windows 原生运行；已有宽权限状态目录会明确拒绝，需要确认部署账户和服务状态目录权限，不能宣称兼容验证通过。
- 第一阶段仍需连接/业务通道并行额度、身份元数据与 permissions 快照、revocation_pending 的控制面衔接及端到端实机检查。配对 staging 不提供掉电 fsync 保证，第二阶段持久业务仍未实现。
- 本次仅上传源码、来源记录和交接，不运行验证。上一成功远端提交：fdc40e2f5e3507ebb6c061aa3cc37a52bacd11be。

## 2026-10-21 01:07（北京时间）命令并行与账户上下文源码检查点

- 新增每业务连接两个命令槽位与最多 64 条排队请求；排队占用原调用超时，超时前未执行明确返回未发送。身份探测绕过业务额度；不同设备独立，连接关闭会拒绝等待队列，错误不关闭其他设备。
- 关闭超时后才返回的 exec 通道，清理同步 exec 异常；新增并行度、排队超时与关闭拒绝检查源码，未运行。会话、SFTP、隧道仍沿用原 relay 通道容量机制，本次不把命令额度说成全部 SSH 通道额度。
- 真实身份探测持久保存 verifiedIdentity、lastVerifiedAt 和 permissionSnapshot。已核验设备的远端实际账户变化时停止自动采用新账户，返回 ACCOUNT_CONTEXT_CHANGED；明确重新配对才能建立新的账户上下文。离线列表显示上次核验时间与账户信息。
- 上传节点不运行验证。上一成功远端提交：1f964bfd13d591516e75a75a8f25d9c2ee6520bb（更新 API 曾超时，但读取远端已确认成功）。
- 第一阶段源码仍未经完整集成或平台实测。接着按设计第二阶段实现有界 control subsystem 和远端任务记录；不能把旧 SSH 命令宣称为已可跨断线持久执行。

## 2026-10-21 01:12（北京时间）控制 subsystem 源码检查点

- 新增 control-channel.cjs，实现四字节大端长度 + UTF-8 JSON 帧、1 MiB 帧上限、严格 UTF-8、有限并发与队列字节/数量上限、写入背压和 RPC ID 关联。流断开只结束订阅，不重发请求；超时提示用原 operation ID 查询结果。
- remote.cjs 在原 exec/shell/sftp 旁新增 relay-control-v1 subsystem；沿用原公钥认证与 Admission，controllerId 从实际成功签名身份绑定，不采信请求 JSON 中的自报身份。控制通道在控制权 drain 时收尾。
- 新增 control-worker.cjs，将控制请求经现有专属 IPC 转交 Far Agent；限制在途数量与字节，Agent 再核对当前授权记录，旧 worker 的请求不被新 worker 实例接管。
- 当前仅 hello(protocol=1) 可用，明确返回 persistentExec=false；submit/get/cancel 仍返回未实现，旧 SSH 命令仍会随原通道终止，不能称已完成持久任务。下一步接 TaskManager 与独立 runner。
- 新增控制通道检查源码，覆盖拆帧/合帧、UTF-8、超长帧、结构化错误、容量与断线未知结果；本批未执行检查、测试、构建或远端操作。
- 上一成功远端提交：3a8a0a970025a95ff7d556c1311194839d070942。

## 2026-10-21 01:15（北京时间）任务存储与 runner 源码检查点

- 新增 task-store.cjs，任务 JSON/执行脚本使用文件 fsync、原子替换与目录 fsync；目录 fsync 不受平台支持时明确返回降级信息，不把 rename 当作全平台掉电保证。
- 新增 task-spec.cjs，规范化 exec 的 command/shell/绝对 cwd/timeout，绑定目标设备和执行器计算 SHA-256；等待参数不参与请求摘要。新增 task-process.cjs，核对系统 boot 与进程启动标识，runner 所属路径也须匹配。
- 新增独立 task-runner.cjs 源码：一次性执行锁、先记录 runner 身份再执行、输出写私有文件，每流最多 64 MiB，超限仍 drain；最终结果 fsync 后再清理私密 input/脚本。支持轮询取消文件，终止前核对执行进程身份；Windows 使用既有 token 和系统 PowerShell，不请求 UAC。
- 目前 runner 尚未接入 TaskManager/submit/get/cancel，因此对外 hello 仍是 persistentExec=false；本批不是新增可用任务能力。Windows 宿主 Job Object 对 detached runner 的影响尚未原生验证，不能保证跨宿主退出存活。
- 本批不执行验证、测试、构建或任何实际任务。下一步接 Far Agent 的 TaskManager，处理 accepted/starting/running 恢复、owner 隔离、输出分页和未知状态，不自动重启无法证明结果的操作。
- 上一成功远端提交：b71ccb8b581f92ab22caf24a4f02f955137e1502。

## 2026-10-21 01:20（北京时间）Far TaskManager 源码检查点

- 新增 tasks.cjs 并接 Far Agent。控制 subsystem 可 dispatch exec submit/get/cancel，owner 取认证 controllerId；相同 operationId+规范化输入返回原记录，输入冲突拒绝，其他 owner 不可读取输出。
- accepted/starting/running 落盘、最多两个运行槽位与 64 条等待、磁盘容量检查、七天终结记录清理、每流每次最多 64 KiB 的 base64 字节分页。未知 runner 保守保留运行额度，不自动重放命令。
- Agent 重启只接管系统 boot、进程启动标识与 runner 路径都匹配的进程；starting/running 无法证明时标记 unknown；runner 增加心跳，最终 result 是完成依据。Agent 退出不主动杀 runner，Windows 宿主退出存活仍未原生验证。
- 取消通过私有请求文件交给 runner，实际终止前核对执行进程身份；只有最终 result 才表示 cancelled。远端撤销授权同时发起逐任务取消，逐项保留未知结果。
- hello/远端能力现在声明任务协议 1 和 verified-live-runner 恢复语义；原 MCP ssh_execute 尚未切换到任务协议，仍按原 SSH exec 行为，不能把接口存在等同原业务全量持久化。
- 新增 TaskManager 检查源码（不启动真实命令），覆盖重复 submit/冲突、owner 隔离、重启 unknown 不重放、排队取消和输出分页；本批未运行检查、测试、构建或任务。
- 下一步接 MCP 控制客户端与近端父操作，先增强 exec，再逐项接 jobs/session；文件分块恢复尚未开始。
- 上一成功远端提交：536b0f6ed1921f236bef2890ee743308b8c6243b。

## 2026-10-21 01:25（北京时间）近端父操作与普通 exec 接线检查点

- 新增近端 operations.cjs：先持久记录 parent operationId、设备 UUID、远端 child operationId 和请求摘要，再由 MCP 发送 submit。近端记录不存原命令；新增注册、列表、分页查询和取消 API。查询/取消复用 Agent 已核验 SSH 探测连接，不要求原 MCP 进程仍存活。
- 新增 agent-control.cjs，共用控制协商并核对实际设备 ID/任务协议；Agent 的控制连接随目标 generation 失效，关闭订阅不取消远端任务。
- 新增 durable-exec.js 并接普通 ssh_execute：目标明确支持任务协议时发送一次 submit，后续只 get 同一 child ID；网络错误返回父 operationId 与 unknown，不自动重发命令。旧目标和旧报告路径仍用原 exec；sudo、jobs 和 session 尚未接持久协议。
- 保留原 stdout/stderr/code/成功字段；新增 operationId/state/completed。内联输出最多 2 MiB，更多输出返回分页要求与精确字节偏移，不取消远端任务。普通等待仍按原 timeout，未终结时明确 pending。
- 新增 ssh_operation_status，支持按父 ID 查询/取消及列出最近操作，供适配器重启后发现原操作；原 37 个工具 schema 未改变。
- 本批未运行测试、检查、构建、真实配对或命令；新增接口与原 exec 的实际兼容性仍未验证。近端记录清理、操作查询错误分级与分组父子编排继续补充。
- 上一成功远端提交：588e1b2fd97466d8acc9805436973ee2528220b2。

## 2026-10-21 01:30（北京时间）节点间局部检查与 PID 命名空间限制

检查均在本轮两个上传节点之间执行，上传节点本身不运行验证：
- 19 项局部回归通过：API 令牌轮换、命令队列、连接 requestId/取消/预留、帧协议、配对事务、私有状态和模拟 TaskManager。27 个当前本地取回的应用文件通过 node --check；这不是全仓库或全部依赖检查。
- 新增三项 Linux 实际 runner 检查首次均超时。定位发现本云端 process.pid 与 /proc/self/stat 实际 PID 不一致，读取 /proc/<process.pid> 会得到其他进程，因此不能可靠证明运行进程的身份。
- task-process 现在先核对自身 PID 命名空间一致性，不一致时返回不可证明；TaskManager 拒绝新持久执行，能力声明 persistentExec=false。runner 也在执行前拒绝该情况并留下 PROCESS_IDENTITY_UNAVAILABLE 结果，不运行命令，不放松 PID 检查。
- 重跑上述组合：22 项中 19 项通过，3 项真实 runner 检查因环境不能证明进程身份而跳过。跳过不等于 runner 存活、取消或超时已经通过。Windows 与匹配 /proc 的原生 Linux 仍需实际执行这些检查。
- 原 SSH 路径的结果显式带 persistent=false，避免把兼容回退当成任务持久保证。未进行任何用户电脑连接、生产部署或运行包构建。
- 上一成功远端提交：d631c76367e420e606ae24f30a988163c9d40e0c。

## 2026-10-21 01:35（北京时间）父操作恢复与结果完整性检查点

- 新增 task-result.cjs，近端与 MCP 都核对远端 operationId/deviceId、状态、base64 编码、分页字节数和单调游标；终结状态缺最终 result 不能被当成成功。Far 记录缺结果时转 unknown，不重跑。
- 近端终结父记录保留七天，查询列表不返回请求摘要或私密路径。控制/HTTP 私有状态错误用固定消息，避免把密钥或操作目录路径带给普通工具结果。
- Provider 单设备描述符失败只影响该设备，其他设备仍可被调用；Agent API 认证或本机状态错误仍整体拒绝发现。新 CLI 可 operations/operation-status/operation-cancel，继续支持 stdin 输入和分页。
- 节点间新增父操作检查三项通过，覆盖注册不 submit、适配器重启后查询原 child、断线不重发、错目标拒绝和取消 requestId 保留；Provider 在线/离线/默认目录/legacy 检查通过。
- 新增实际 runner 拒绝检查，在本环境 PID 命名空间不一致时，确认结果为 PROCESS_IDENTITY_UNAVAILABLE 且未产生命令标记文件。最近组合共 8 项：5 通过、3 个原生 runner 功能检查跳过；不能用拒绝检查冒充持久执行功能通过。另与 TaskManager 的六项组合检查通过。
- 尚未做 SSH/MCP 完整集成、Windows 原生检查、分组父子编排、jobs/session 持久化、文件分块恢复或运行包构建。上传节点仅保存和上传源码。
- 上一成功远端提交：c54b894f82e5d1a4980c78edbd42926e729c2410。

## 2026-10-21 01:40（北京时间）受控 job 注册与 runner 源码检查点

- 新增 task-jobs.cjs/job-executor.cjs，将原 alerts/backup/database/health/schedule/tail 六个随包模块登记为受控作业。任务含模块 SHA-256，hello/能力公布目录；版本不匹配在启动前拒绝，不接受客户端上传实现代码。
- job-executor 使用一次读取并核验的随包源码执行，避免版本校验后第二次读文件换入不同实现；原业务模块未改。参数规范化按 JSON 键排序，等待参数不参与摘要，参数和实现版本变化会改变摘要。
- TaskManager/runner 增加 job kind。作业参数保存在私有 input；临时目录限制到该操作 tmp 子目录，终结后清理，避免取消后外部临时凭据残留。并行、owner、一次执行锁、输出上限与取消仍用同一任务机制。
- 本批只接 Far 任务 kind；MCP jobs.js 仍是原路径，下一步切换到版本匹配的受控任务。sudo、session、部署多阶段和分组父子编排仍未完成。
- 节点间受控 job/父操作组合五项通过；TaskManager/runner 组合四项通过、三个原生 runner 功能检查因本云端 PID 命名空间不一致跳过。runner 新分支通过语法检查，但未在 Windows 或原生 Linux 实际执行作业。
- 上传节点不运行验证。上一成功远端提交：79e2aca4f969d0bd5993867b391c658e2f8db1b3。

## 2026-10-21 01:45（北京时间）MCP 受控 job 接线检查点

- MCP jobs.js 在目标明确支持任务、作业模块摘要匹配时走 durableJob；不再为这条新路径构造巨大 node -e 或临时上传实现。旧目标继续原兼容路径并返回 persistent=false。
- 普通 exec 与受控 job 共用 task-call.cjs：先保存父/子 ID，submit 仅一次，之后只 get；未知结果原样返回保存的 ID。终结后仅查询少量元数据更新近端观察状态，日志仍按页远端读取。
- 保留原作业 JSON 返回形状并增加 operationId/state/completed；多阶段 handlers 中 checked 抛错也保留操作 ID，不让调用方失去不确定阶段的查询入口。
- 节点间六项相关检查通过：确认丢失不重发、跨字节页 UTF-8、精确内联输出游标、错设备结果拒绝、作业规范化和版本不匹配拒绝；本批修改的 MCP job/durable-exec/handlers 通过语法检查。仍未通过真实 SSH/MCP 或平台任务执行检查。
- schedule 原有生成计划任务脚本的内部参数路径、多阶段部署/数据库组合的父操作编排、session runner 和分组父子操作仍需继续；文件恢复阶段尚未开始。
- 上传节点只上传源码与交接。上一成功远端提交：1c3af6bce1af84c48635d7ae82fbf291fa4e301e。

## 2026-10-21 01:50（北京时间）计划任务模块引用源码检查点

- 受控 schedule 新路径只接受 backup/database 的模块名、摘要与参数，拒绝实现源码。MCP 不再把备份/数据库模块源码作为 schedule 参数传给这条路径；旧目标仍保留原兼容逻辑。
- 调度脚本仅保存随包模块引用和版本核对逻辑，参数另存用户目录下的私有 JSON，不进入进程命令行。应用升级改变模块摘要后，计划任务拒绝自动采用不同实现，需要检查并重新注册。未来 OS 调度触发仍沿用原调度器生命周期，不承诺每次触发都已有 Far TaskManager 父操作。
- 节点间模拟调度器注册检查通过：所有系统调度调用被测试桩接管，仅在临时目录写入；确认参数不嵌入脚本、参数文件权限为私有、受控路径拒绝实现源码。未修改真实 crontab 或 Windows 计划任务。相关六项任务调用/注册回归与修改文件语法检查通过。
- 分组父子编排、多阶段事务、session 恢复和文件分块仍待开发；Windows 和原生 Linux 进程功能检查仍未覆盖。上传节点不运行验证。
- 上一成功远端提交：72f995f1f0726af23054e70599804ad15a8b1492。

## 2026-10-21 04:00（北京时间）分组目标预检模块准备

- 新增 group-targets.js 纯函数：分组执行前要求 1～5 个目标，对同一已验证设备的重复别名拒绝重复执行；无法解析的成员保留交由既有逐机错误报告处理。
- 新增 mcp-group-targets.mjs 六项测试源码，覆盖顺序、重复别名、超过五台、离线目标、离线重复名称和旧配置别名；本节点未运行测试或远端命令。
- 该模块尚未接入 ssh_execute_group；当前分组执行行为未改变，也未实现持久父子操作编排。下一步接线前需复核并行策略和失败后结果查询，不得把准备工作当作已完成能力。

## 2026-10-21 01:54（北京时间）分组记录与取消竞态源码检查点

- 新增近端 operation-groups.cjs，支持一至五个固定设备的父/子 ID 和摘要记录；先写组计划及所有子记录再允许上层派发。状态逐机查询，一台未知不重跑其他完成主机；取消逐子返回结果。MCP 分组执行尚未接该计划上下文。
- 近端新增 dispatch 意图和 not-started 标记；普通持久 exec/job 在发 submit 前先记录派发意图。尚未派发的取消可本地完成，已可能派发的不能假称未执行。
- Far TaskManager 新增取消先于 submit 的记录：同 owner/operationId 后续到达的 submit 绑定摘要但返回已取消结果，不执行；重启后仍保留，输入改变仍拒绝冲突。避免“用户已取消而稍晚的网络请求才开始执行”的竞态。
- 节点间五项分组/任务组合通过，包含查询不 submit、部分设备离线保留已完成结果、目标计划冲突、取消先到达后重启及普通幂等检查。另父操作/TaskManager 六项通过。均为临时目录、模拟控制或进程桩，不是多机实际连接。
- 下一步将原 ssh_execute_group 接固定计划，保留原策略/停止行为；session 和文件恢复仍未实现。上传节点不运行验证。
- 上一成功远端提交：da8df9855161491a783639123d11d06e519c199e。

## 2026-10-21 14:22（北京时间）接续上传

- 保留远端 fab86aa 的分组目标预检与交接，补交分组记录和取消竞态源码。
- 上传节点未运行验证；分组 MCP 接线仍待继续。


## 2026-10-21 14:25（北京时间）分组预检接线与记录加固

- ssh_execute_group 接入既有 group-targets：派发前拒绝超过五台、重复名称和同设备别名；保留并行/顺序/滚动策略，并拒绝未知策略。
- 加固持久分组记录读取：核对子 ID、设备唯一性、摘要及父组关系，拒绝指向自身或其他组的递归记录；单子操作注册不能跨组复用。
- 节点间十一项局部检查通过，覆盖目标预检、损坏记录、父操作查询及不重发。修正旧预检测试使用相同大小写名称导致命中另一拒绝分支的问题，改用两个不同别名测试 canonical identity。
- 这些检查使用临时目录和模拟控制，未进行真实 SSH/MCP 或原生平台运行。当前仅接目标预检，MCP 分组执行仍未接固定父子 ID；不能宣称完整分组持久恢复已完成。
- 本上传节点仅保存源码和交接，不运行验证。上一成功远端提交：133ebd09b31b7a61ee19ca282b39db2a7cc7737f。

## 2026-10-21 14:30（北京时间）分组固定父子计划源码接线

- Agent 模式下整组均声明任务协议 1 与 persistentExec 时，先逐目标建立已核验业务连接，再注册完整组计划及所有子 ID，之后沿用原 parallel/sequential/rolling 策略执行。任一前置连接失败时不派发组内命令；旧报告、混合能力或未解析目标仍走原逐机兼容流程，组级 persistent=false。
- 新增 operation-context.js，以 AsyncLocalStorage 隔离并发分组计划；普通 durableExec 在组上下文使用预分配父/远端子 ID 和摘要。执行输入、设备 UUID 或任务能力改变时拒绝，不重新分配 ID 或静默回退。
- 原分组返回增加组 operationId 和子查询入口；异常保留已分配子 ID。顺序停止后只将从未记录 dispatch 意图的子操作标为 not_started，未遍历主机也出现在结果中。组状态与取消可经 ssh_operation_status 查询原记录。
- 节点间十六项局部检查通过，覆盖并发上下文隔离、目标预检、分组记录、父操作及任务轮询；修改文件语法检查通过。尚未做 helper 到真实 MCP/SSH 的完整集成或原生 Windows/Linux 任务运行；不能把这些结果视为分组端到端恢复通过。
- 当前没有用 operationId 重新调用分组执行的 schema；恢复入口是查询/取消原组和子操作，不自动补跑未启动主机。session 持久 runner、多阶段事务和文件分块恢复仍待继续。
- 本上传节点仅保存源码、来源记录和交接，不运行验证。上一成功远端提交：fafbee32e45b4c3373c9df9351321223410c2d4a。

## 2026-10-21 14:33（北京时间）分组编排检查与归属加固

- 抽出无 SSH 依赖的 group-plan.js，生产 helper 委托同一实现。新增检查覆盖完整计划先落盘、固定子 ID、连接失败/身份变化不注册、注册应答丢失保留查询 ID、混合能力兼容和重复设备提前拒绝。
- 修复已有子 ID 被新组计划捕获的风险：保存任何组记录前检查全部既有子身份；查询和取消前再次核对实际子记录与组计划的父 ID、设备、远端子 ID、摘要及 kind。损坏归属不连接远端、不改变无关子状态。
- 增加终结组和 not_started 子记录的七天清理，活动计划保留；损坏记录保守保留供处理，不假装已完成。
- 节点间最近组合十四项通过，涵盖上述编排、并发上下文、归属/清理和任务轮询。另编排/分组/普通父操作十一项组合通过。这些均为本地受控检查，真实 SSH/MCP、五机和 Windows/原生 Linux 运行仍未验证。
- 下一步继续第二阶段 session runner 与多阶段父操作；现有 session 仍依赖原 MCP shell，退出或断线不可恢复，文件恢复第三阶段尚未开始。
- 本上传节点仅保存源码、来源记录和交接，不运行验证。上一成功远端提交：2570bd167114b41f11b83c46ab48391fea9d624b。

## 2026-10-21 14:36（北京时间）会话命令日志准备源码

- 新增 session-journal.cjs，只实现远端独立会话 runner 将使用的私有命令日志，不创建 shell、不接控制 RPC、不改变 sessionResume=false 或原 session 工具行为。
- 日志绑定 device/session/controller owner/platform/system boot；命令包含请求 ID 和严格递增序号，同 ID 同输入返回原记录、不同输入拒绝。一次性 execution.lock 在返回可执行输入前写入并 fsync；已认领请求不能再次认领。
- 最终结果先持久保存再清理私有命令输入；重开日志只恢复既有结果，accepted/running 无结果记 unknown，不自动重跑。即使命令已完成也不推断原 shell 存活；system boot 变化禁止新命令并返回 SESSION_LOST。每会话最多一万条命令。
- 节点间四项日志检查通过，覆盖幂等/冲突/owner、一次认领与命令序号、重开 unknown/boot lost、最终结果查询。这些仅为临时目录日志检查，未启动 shell 或模拟会话存活。
- 下一步必须接独立 session runner 的单写者生命周期锁、进程身份核验、限额输出和协议，再允许恢复存活 shell；当前日志类本身不提供进程存活或多写者保证，不能单独对外启用会话恢复。原 MCP session 退出/断线仍不可恢复。
- 本上传节点只保存源码、来源记录和交接，不运行验证。上一成功远端提交：fa5b398beeddeb05a9b31632db5202ce31d586b7。

## 2026-10-21 14:39（北京时间）会话输入与双流结果边界源码

- session-journal 认领命令前重新规范化并核对私有 input 与持久摘要；返回同一次读取的输入，不在核验后换读。最终结果文件缺失时，查询返回 unknown/completed=false。
- 新增 session-output.cjs 字节解析器，为未来无 PTY 会话 runner 解析随机完成标记。stdout 保存 exitCode 与严格 UTF-8 cwd，stderr 独立确认完成边界；两路均确认后才允许完成，不因 stdout 先到就丢失迟到 stderr。
- 每流最多向日志 sink 交付 64 MiB，超限继续 drain/解析并记录准确截断字节；完成标记后的后台输出单独交付，不附到已完成命令。完成边界有 256 KiB 上限、严格 ASCII/base64 校验；任何错误后解析器永久失效，不接受后续补造成功。
- 节点间九项会话日志/解析检查通过，包括所有切分位置的 UTF-8 原始字节、双流完成次序、输出截断、迟到输出、缺边界和损坏字节、输入摘要变化及缺结果。这些检查未启动 shell，不证明真实 PowerShell/sh 边界脚本或 runner 生命周期已实现。
- 会话独立 runner、单写者锁、进程核验、控制 RPC 和 MCP 适配仍待接线；sessionResume 仍为 false。下一步不能直接向外宣告可恢复会话。
- 本上传节点只保存源码、来源记录和交接，不运行验证。上一成功远端提交：c3f7a3a9bcfed67c8265171d06f0c4a670ca7b9d。

## 2026-10-21 14:42（北京时间）无 PTY shell 边界脚本源码

- 新增 session-shell.cjs，为 sh/PowerShell 生成双流完成边界脚本，保留同一 shell 的 cwd/环境，命令通过 stdin 而非进程命令行传递；Windows 脚本编码原命令并在当前会话作用域执行。随机 marker 和输入按界限校验。
- 在本机临时目录启动 /bin/sh -s 检查，确认连续命令保留 cwd/环境、stdout/stderr 分开、失败 exitCode、中文输出、含换行的目录名，以及伪造 PWD/NODE_OPTIONS 不改变 cwd 元数据读取。只创建临时目录和子 shell，未连接用户设备。
- 首次检查发现 pwd 的尾换行被编码进 cwd，已改为用当前应用 Node 的绝对路径读取实际 cwd 并编码；该辅助 Node 临时清空 NODE_OPTIONS/NODE_PATH，不改变原 shell 环境。
- 十一项日志/解析/shell 组合检查通过，新增特殊 cwd 断言后两项 shell 检查通过。Windows PowerShell 脚本尚未原生执行；本机 sh 检查不等于独立 runner 存活、取消或 SSH 恢复通过。
- 本模块仍未接独立 session runner、生命周期锁和控制协议；sessionResume=false 与原 MCP session 行为继续保留。下一步继续 runner 生命周期及日志输出落盘，不能把边界脚本当作会话持久化已完成。
- 本上传节点仅保存源码、来源记录和交接，不运行验证。上一成功远端提交：a25397a695df0ffd9781db91e1a9aa056b12c9cb。

## 2026-10-21 14:45（北京时间）会话私有输出存储源码

- 新增 session-log.cjs：每命令 stdout/stderr 独立 0600 文件，独占创建、不覆盖旧输出，每流最多保存 64 MiB；超限仍接受 drain 并累计总字节，结束时 fsync 后关闭。写入或 fsync 失败不返回成功收尾。
- 字节分页每次最多 64 KiB，以 base64 和精确 nextOffset 返回；拒绝越界 cursor、非法流名、符号链接和超限文件。读取/写入错误使用固定消息，不泄漏私有目录。
- shell cwd 辅助 Node 增加 ELECTRON_RUN_AS_NODE=1，以适配既有 Electron 运行包；并非已用 Electron 原生运行验证。
- 节点间十四项会话组合检查通过，包括输出保存后重读、跨 UTF-8 分页、截断、关闭后写入拒绝、存储错误注入、双流边界和临时 sh 连续命令。没有远端连接或 Windows 原生执行。
- 后续 runner 接线须使用解析器完整 totalBytes/truncated 元数据与 sink 实际保存字节合并结果，并在日志 fsync 成功之后写最终命令结果。独立 runner/单写者锁/进程证明/RPC 尚未实现，sessionResume 继续 false。
- 本上传节点只保存源码、来源记录和交接，不运行验证。上一成功远端提交：c15386c4f901e3b3aee140e4bff0be662a526ba3。

## 2026-10-21 14:50（北京时间）内部会话执行器源码接线

- 新增 session-engine.cjs，将日志、输出 sink、双流解析和 shell 边界接成内部单写者执行器；engine.lock 只独占创建，不自动接管旧锁或重建旧 shell。宿主进程身份不可证明时不创建 shell，shell 身份不可证明时不发送业务命令。
- 同一命令请求只认领并写 stdin 一次；日志 fsync 成功后才保存最终结果，cwd 与准确输出计数持久保留供后续查询。会话日志新增 lose 状态及错误码，超时/通道错误/边界损坏/存储失败把未决命令记 unknown、会话记 lost，不重跑命令或伪称已取消。
- 关闭时先关闭该 shell 的输入；只有当前进程 boot/startToken 与保存身份匹配才终止所属进程树。Windows taskkill 完成与宿主 Job Object 行为仍未原生验证，返回 lost 而非宣称 cancelled。
- 节点间九项执行器/日志检查通过。执行器检查使用模拟进程和管道，不创建真实业务进程；覆盖一次 stdin、双流确认、落盘结果、超时失效、旧锁拒绝、PID 身份变化不发信号，以及不可证明宿主不 spawn。
- 本类尚未作为独立 runner 进程运行，也未接 Far Agent/RPC/MCP。下一步需独立宿主与认证 inbox/查询、runner 心跳/所属路径证明及原生进程测试；sessionResume 仍为 false。文件分块第三阶段尚未开始。
- 本上传节点只保存源码、来源记录和交接，不运行验证。上一成功远端提交：9332c1fb7eab69122982e75d2714c282d910cce4。

## 2026-10-21 14:54（北京时间）独立会话宿主准备源码

- 新增 session-runner.cjs，可作为独立进程宿主读取私有 session.json，核对设备/会话/owner、平台和 system boot，再创建内部执行器。私有 inbox 限 64 项，固定 owner 来自启动记录，响应不带原命令；不能把请求 JSON 的自报 owner 当认证。
- 宿主写 runner 身份和两秒心跳；命令经同一执行器幂等，close/超时失效后收尾响应并退出。旧 engine.lock 不接管，不因旧任务未知而重新创建 shell。此入口尚未由 Far Agent 启动或暴露 RPC。
- 节点间十项执行器/日志/宿主检查通过，其中一次实际启动独立 Node 宿主，在当前不匹配 /proc 的命名空间确认返回 PROCESS_IDENTITY_UNAVAILABLE，未创建 engine.lock 或命令目录；这是拒绝执行检查，不是持久 shell 功能通过。其余执行器使用模拟进程。
- 下一步需 Far 侧认证 SessionManager、runner 所属路径核验、请求文件原子提交/结果查询及 MCP 原 session ID 适配。当前 sessionResume 仍 false，不能连接此私有 inbox 绕过 Agent 认证。Windows/匹配 /proc 的原生 Linux 存活及取消仍待实测。
- 本上传节点仅保存源码、来源记录和交接，不运行验证。上一成功远端提交：fd659c410d9468f83f10e7c2ff3407594c3b07de。

## 2026-10-21 14:58（北京时间）会话只读查询与进程归属源码

- task-process 增加 ownedSessionRunner，并将旧 task runner 的 Windows 命令行匹配改为完整参数边界；相同目录前缀或脚本后缀不能当成所属进程。仍必须先核对系统 boot/startToken，不绕过本环境 PID 限制。
- 新增 SessionJournal.reader，只读命令和最终结果，不 recover、不改写 manifest、不创建缺失目录；写入方法明确拒绝。新增 session-reader.cjs，每次检查 controller 授权和 owner/device/session，逐命令字节分页；shell 未证明存活时返回 unknown，已证实换 boot 或已 lost 时返回 lost，历史最终结果仍可查询。
- 修复执行器结果收尾异常：最终 metadata 读取抛错时仍保留 active waiter，使调用方收到 unknown，不因先清空 active 而永远等待。
- 节点间进程参数/TaskManager/独立宿主七项组合、执行器故障/归属/宿主八项组合和只读查询/日志七项组合通过。查询检查确认 owner 隔离、授权撤销拒绝、查询不改写运行日志和 shell 丢失后历史结果保留。Windows 参数检查是字符串检查，不是 Windows 原生进程证明。
- 仍未接 SessionManager 创建/认证 inbox 提交与 Far RPC/MCP；sessionResume 继续 false。独立宿主真实持久 shell 在本环境不可证明，必须保留拒绝能力，不能放松进程身份校验。
- 本上传节点仅保存源码、来源记录和交接，不运行验证。上一成功远端提交：23ddaf3b709dd534dea1127a13a48eac693cbd07。

## 2026-10-21 15:03（北京时间）内部 SessionManager 源码

- 新增 session-manager.cjs，绑定 Far deviceId 与逐调用 controller 授权；会话 ID/规范化 startup cwd 幂等，先持久 session.json，再只 spawn 一次独立宿主。重复创建和 Manager 重启只查询原目录，不重新创建 shell；进程身份不可证明时拒绝新会话。
- 命令 intent 先保存摘要与请求 ID，再发布一次私有 inbox；重复请求只查询旧记录。输入变化拒绝冲突；中断发布或 inbox/结果均缺失时返回 unknown，不重新发布或执行。私有 request metadata 不保存原命令。
- 对创建记录和请求 inbox 分别加 64/10000 的有界容量；这是内部初始容量，不代表已完成长期清理策略。新增 startup metadata 校验及 null 字节输入拒绝；日志分页复用只读 owner 查询。
- 节点间五项 Manager/Reader/宿主组合通过，覆盖创建及重启不 respawn、输入冲突、owner 隔离、丢失 inbox 不重发、不可证明身份不 spawn 和宿主实际拒绝检查。Manager spawn 使用测试桩，不能称实际独立会话功能已通过。
- 下一步：Far control 认证 dispatch、撤销 owner 后关闭、near/MCP 原 session 工具适配、session 结果保留清理及真实平台运行。当前 Manager 未挂到 Agent，sessionResume 仍为 false。
- 本上传节点仅保存源码、来源记录和交接，不运行验证。上一成功远端提交：654e018c5e6a431fe918981929c395f8fa11f1a1。

## 2026-10-21 15:08（北京时间）会话撤销源码与架构必要性边界

- SessionManager 增加可信内部 revoke(owner)，授权移除后仍可按原 owner 写私有撤销标记；重复撤销保留同一 requestId，不影响其他 owner。返回 close_requested，不声称进程树已停止或副作用已撤销。
- 独立宿主在启动 shell 前检查撤销标记，并在处理新 inbox 前轮询检查；撤销后未决命令 unknown、会话 lost，写 stopRequested 观察记录。Windows 实际终止完成尚未证明，不返回 cancelled。
- 节点间六项 Manager/宿主组合通过，包含授权移除后幂等撤销、owner 隔离和实际启动已撤销宿主时拒绝创建 shell。其余 Manager spawn 使用测试桩，不能当作原生持久会话通过。
- 术语已澄清：近端/远端 Agent 都是后台服务，不是 AI Agent 或提示词工程。用户确认此前仅为名称误会，要求继续按既定文档开发，不改变架构目标或实施顺序。
- 下一步仍是 Far 认证路由、撤销接线及原 MCP session 适配。公开 sessionResume 继续 false；本批未把内部服务暴露成可用功能。
- 本上传节点只保存源码和交接，不运行验证。上一成功远端提交：1216efe2faaa3256ae7ef9fad455740bac2d924b。
- 上次上传调用被用户消息中断，本段不能视为已推送成功；接续时补交并以实际远端提交号确认。

## 2026-10-21 15:13（北京时间）Far 认证会话控制接线

- Far Agent 创建 SessionManager，原 SSH 签名绑定的 controllerId 经 worker IPC 进入 session.create/status/send/get/close 路由；每次继续核对 authorized-clients，不读取参数中的 owner 作为身份。原 task 路由保留。
- 撤销授权同时触发所属会话 revoke；Manager 启动及周期检查补写已移除 owner 的撤销标记，覆盖授权文件已提交但关闭标记未提交时的中断。Far Agent 正常退出不主动关闭独立会话宿主。
- hello 与远端身份元数据增加 sessionProtocol=1、sessionResume 的进程身份能力条件。本环境条件不满足，继续报告 false；这不是 Windows 或原生 Linux 功能通过声明。原 MCP session 工具尚未切换到新协议。
- close receipt 仅表示宿主已处理关闭请求，返回 lost/stopRequested，不保证 Windows 进程树已经停止。SESSION 错误进入固定结构化错误映射，底层私有存储错误仍隐藏路径。
- 节点间十二项会话 Manager/执行器/宿主组合通过，新增 Agent 重启后授权丢失的撤销补写和自报 owner 不改变真实 owner 检查；另九项 Manager/Reader/TaskManager 组合通过。Agent/remote 修改通过语法检查，尚未启动真实 Agent/SSH 集成。
- 下一步接近端 session 目录与请求 ID 记录、原 MCP session 工具恢复查询，并补认证控制路由的隔离检查。会话长期清理、多阶段业务和文件恢复仍未完成。
- 本上传节点只保存源码和交接，不运行验证。上一成功远端提交：ebc4740786b0d29767af31ba7ef543c240812a45。

## 2026-10-21 15:18（北京时间）认证路由检查与近端会话记录

- 抽出 far-control.cjs，生产 Agent 委托同一薄路由；逐请求核对授权，controller 来自签名绑定上下文，JSON owner 不覆盖。局部检查覆盖任务/会话分流、协议版本拒绝和授权删除后拒绝。
- 新增 session-spec.cjs，Far/后续 MCP 共用规范化请求摘要；绑定 session/sequence/命令/shell/timeout，排除等待字段和不同 requestId，拒绝 null 字节、非法 cwd 及超界序号。
- 新增 near-sessions.cjs，只记录稳定 ssh_UUID、固定 deviceId/远端 session UUID、展示名和请求摘要/序号；不保存原命令，不派发业务。重开后可以枚举原请求并仅调用 session.status/get，校验响应目标、请求 ID、字节分页与完成依据。
- task-result 补充分页输入自身的非负安全整数及 64 KiB 上限校验。近端会话 HTTP/SDK/MCP 适配尚未接，不把记录模块当作原工具恢复已完成。
- 节点间八项 NearSessions/任务轮询/父操作组合通过；另七项规范化/Manager/Far 路由组合通过。均为模拟控制和临时文件，未验证真实 SSH/Agent 会话；当前云端 sessionResume 因进程身份条件为 false。
- 下一步接近端认证 API、SDK 和原 MCP session 工具，不新增替代原工具的一整套业务接口；保留旧目标兼容路径的明确恢复限制。
- 本上传节点只保存源码、来源记录和交接，不运行验证。上一成功远端提交：f5ebf27f6f5679531c44152860a5fd6641f7822b。

## 2026-10-21 15:23（北京时间）近端会话 API 与单次提交调用器

- 近端 Agent 新增认证 /v1/sessions 元数据注册/列表、会话状态、请求元数据注册/列表和按 requestId 查询；共享 SDK 增加对应入口。API 不接受命令实现，不替 MCP 派发新会话命令。
- 新增 session-call.cjs，使用近远端共用规范化摘要，先保存近端请求 ID/序号，再只调用一次 session.send；后续仅查询原请求。复用有界字节分页与 2 MiB 内联捕获，返回 session/requestId 与精确 cursor，不把它伪装成普通 operationId。
- 回应丢失保留 ID 并返回 unknown，不自动重发。近端会话完成声明还需符合请求类型、最终 result 和双流分页，不接受缺结果的成功声明。
- 节点间三项调用器/近端记录组合通过，覆盖登记先于提交、一次提交后只 get、UTF-8、错目标和缺结果拒绝、丢失确认不重试；另共享 SDK/近端记录/Far 路由三项组合通过，Agent 修改通过语法检查。
- 当前原 MCP sessions.js 仍是旧实现，下一步切换 facade 并保留 legacy 路径，同时让适配器退出只断开订阅、不关闭持久会话。尚未做真实 SSH/MCP 或 Windows/原生 Linux 持久运行检查。
- 本上传节点只保存源码、来源记录和交接，不运行验证。上一成功远端提交：198d2623407eb024c7e2e76ac6cacb1fa3de811b。

## 2026-10-21 15:28（北京时间）原 MCP 会话 facade 源码接线

- 原 sessions.js 变为 facade，已有实现原样保存在 legacy-sessions.js 并登记来源。新目标按 sessionProtocol/sessionResume 走持久服务，先登记稳定 ID 再只 create 一次；旧目标继续旧 shell，并明确 persistent=false。
- start/send/list/close 仍保留原工具 schema；列表可找回近端记住的 ID，发送前核对固定设备与上次请求终结，不对 unknown 自动重发。MCP 退出仅释放持久会话的本地引用，不关闭远端宿主；legacy 会话仍按原方式关闭。
- ssh_operation_status 新增可选 sessionId，和 requestId 一起查询原命令及字节分页；未给 requestId 时列原请求 ID。普通 operationId 逻辑保留，取消会话继续使用原 ssh_session_close。
- 原 close-all 改为最多四个并发、逐项返回未知结果，不因一台失败丢弃其他结果。会话 cwd/平台随可信状态保存，平台改变拒绝继续采用旧会话。
- 节点间十项调用器/近端记录/只读查询/日志组合通过；facade、handlers/server 修改通过语法检查。facade 本身尚未做依赖隔离运行检查，更未做实际 SSH/MCP 或原生平台集成，上传不以这些待办通过为条件。
- 下一步补 facade 的关闭/重启/未知结果隔离检查及并发序号预留；长期清理、实际平台运行、多阶段业务和文件恢复仍未完成。
- 本上传节点只保存源码、来源记录和交接，不运行验证。上一成功远端提交：ed66cb478a98c42ebbef226db02f8d20fc0e1487。

## 2026-10-21 15:33（北京时间）facade 隔离检查与近端序号预留

- 新增 mcp-sessions.cjs，以 VM 模块和替代依赖运行真实 facade 源码，三项通过：MCP detach 不调用远端 close、重开列表找回 ID、未决请求阻止再发送、丢失 create 确认保留 ID 且不重试/不回退、legacy 仍按原方式关闭。执行命令需 node --experimental-vm-modules --test tests/pro/mcp-sessions.cjs；这些不是实际 SSH/MCP 集成。
- NearSessions 增加单序号到单请求的持久预留，近端 API 同步写入；先保存序号预留，再写请求元数据，避免两个适配器同时取得同一 Far nextSequence 后各自派发。旧请求元数据按需建立一次索引，冲突不猜测。
- 两项近端记录/序号检查通过，包含不同适配器实例只能复用同一请求、不同请求抢相同序号拒绝；注册和状态查询不派发命令。
- 下一步继续 close 优先级、满命令额度仍可关闭、历史会话清理及整体契约检查。Windows/原生 Linux 进程功能、真实 SSH/MCP 与五机仍未验证；未构建运行包。
- 本上传节点只保存源码和交接，不运行验证。上一成功远端提交：78fa1e98daec69da27ac32a851c63fbe59bcd08d。

## 2026-10-21 15:37（北京时间）优先关闭与满额关闭源码

- 会话 close 改为独立的 owner-bound close.json 标记，宿主在普通 inbox 前处理；Manager 一旦观察到 close/revoke 标记就拒绝新命令。启动尚未完成或命令 inbox 满时也允许发布关闭，不让控制请求卡在业务队列后。
- 近远端都为一万条命令之外保留一个关闭记录槽位；重复关闭复用已保存请求，MCP 不继续生成新关闭请求。返回 stopRequested/lost，仅说明逻辑会话不可再用，不声称全部进程树已证实停止。
- 宿主启动前观察到 close 时写关闭请求 receipt 并拒绝创建 shell；撤销标记仍优先。近端序号索引增加 marker 身份与格式检查。
- 节点间十三项 facade/Manager/独立宿主组合通过；三项近端元数据检查通过。新增满命令/满 inbox 仍可关闭、重复显式 close 只提交一次、启动前 close 实际不创建 engine，以及近端满额关闭槽位。测试使用容量桩，不创建一万条真实命令；独立启动检查只验证拒绝执行。
- 下一步会话结果保留/清理及完整契约组合检查，之后继续第二阶段多阶段父操作。真实 SSH/MCP、Windows 与可证明进程身份的原生 Linux 功能检查仍未完成。
- 本上传节点只保存源码和交接，不运行验证。上一成功远端提交：5d76fd8a95a1d388ac6a30483afadd7452065e94。

## 2026-10-21 15:43（北京时间）会话保留期与进程退出证明源码

- shell 启动后、接收业务前持久保存 shell.json 身份；宿主先写自身 runner 身份，再创建 engine，避免只保存 shell 却没有宿主身份的窗口。lost 记录保存 closedAt。
- 新增 processState，区分 alive/exited/unconfirmed；同 boot 必须先证明本机 PID 命名空间，Linux 明确 ENOENT/zombie 或不同 startToken 才判原进程退出；Windows 使用有错误界限的 CIM 不存在查询，失败仍 unconfirmed。
- 新增 session-retention.cjs，七天后仅清理 owner/device/session/boot/所属目录一致、宿主和 shell 均明确退出的终结记录；无 shell 的已失败启动另作保守处理。活跃、身份未知或损坏记录保留。Manager 周期及容量不足时有限检查候选。
- 节点间十二项清理/engine/Manager 组合通过，清理使用进程状态桩，确认 alive/unconfirmed 保留、exited 且过期才删除。Windows 清理性能与原生进程退出查询未实测。
- 下一步补清理扫描轮转，避免前两个长期未知记录挡住后续候选，并完成整体会话契约检查；不能把有限局部检查当作真实平台或 SSH/MCP 已通过。
- 本上传节点只保存源码、来源记录和交接，不运行验证。上一成功远端提交：ddf4b2e96878f2ba44309098c57feaf4ba50790b。

## 2026-10-21 15:48（北京时间）轮转清理与磁盘容量检查源码

- 清理以候选游标轮转，每次有限检查后下次从后续候选继续，不让前两条长期 unknown 卡住其他过期记录。Manager 容量检查和周期清理共享该游标。
- 会话创建前检查元数据余量，命令发布前和 engine 认领前检查有界输出余量；磁盘不足时不向 shell 写业务输入。关闭/撤销不依赖这项业务容量检查，仍可能因真实存储写入失败返回 unknown，不假称已关闭。
- 节点间完整会话组合 43 项通过、无跳过；包括 VM 隔离 facade、模拟进程/状态、临时 sh 和独立宿主拒绝启动检查。之后十四项 engine/Manager/retention 组合通过，新增磁盘不足不写 stdin 与轮转跳过未知候选检查。
- 这些不是实际 SSH/MCP 或 Windows/可证明 PID 的原生持久功能通过。会话命令与普通 TaskManager 的共享执行额度仍需接线，当前不能宣称所有命令统一满足默认并发二；会话端到端整体契约和平台验证仍待完成。
- 下一步优先统一 Far 执行额度与恢复后的槽位记忆，再继续第二阶段多阶段父操作；文件恢复和运行包仍未交付。
- 本上传节点只保存源码和交接，不运行验证。上一成功远端提交：3a5cb6aff89ec6681c2603edf21416e20a1b2208。

## 2026-10-21 15:53（北京时间）共享执行调度器源码准备

- 新增 execution-scheduler.cjs，默认两个共享槽位与 64 条等待额度，按全局 createdAt/固定 key 排序选择 task/session provider；provider 必须先持久执行 claim 才返回占位成功。调度器拒绝无效快照并防止重入重复派发。
- TaskManager 增加可选 scheduler provider 接口，保留未配置时的原路径；队列容量和磁盘预留可计入共享状态，未知 active 继续占位。当前 Far Agent 尚未挂该调度器，SessionManager permit/恢复接线下一批完成；不能把准备源码当作共享额度已启用。
- 节点间七项 TaskManager/调度器组合通过，覆盖全局先后次序、共享二槽、未知占位不释放、失败 start 和重入不超额，原 TaskManager 幂等/取消/不重放回归通过。provider 检查使用状态桩，非实际进程调度验证。
- 下一步为会话派发加持久 permit，runner 无 permit 不执行；恢复时保留未知 permit，再把两个 provider 接到 Far Agent。关闭/撤销继续绕过业务额度。
- 本上传节点只保存源码、来源记录和交接，不运行验证。上一成功远端提交：0588931a90650e6914ed1165acb922978c506649。

## 2026-10-21 16:12（北京时间）用户覆盖：禁止磁盘检查与自动清理

- 最新用户要求覆盖此前七天保留/磁盘余量方案：取消 TaskManager、SessionManager、engine 的空间探测；取消任务、会话、近端操作及组记录的自动过期删除；取消诊断日志自动轮转覆盖。健康监控入口保留，disk 返回空数组，不再读取容量。
- GUI 新增一个手动清理日志按钮，经现有受鉴权后台接口清空固定诊断文件；不遍历用户文件，不删除任务状态、恢复索引、幂等记录。实际写入失败仍必须如实处理，不能假称命令成功。
- 新增 session-executions helper 的准备源码仍未接到 Runner/Manager/Far 调度器，不能宣称共享执行额度已完成。
- 原 37 MCP 工具入口/参数保留不等于完整可用证明：真实 SSH/MCP、Windows、可证明 PID 的原生 Linux 持久执行仍未验证。本次用户覆盖改动尚未验证；下一步定向回归，旧磁盘/自动清理测试需按新约束修改。
- 本上传节点只保存源码与文档，不运行验证。上一成功提交 adf8b58e00ee1657ff6376a178c4154e4ffa03e3。

### 用户覆盖后的定向回归

- 移除已不适用的 session-retention 源码及测试，避免保留删除整个会话目录的旧实现。
- 23 项任务/会话 Manager/engine/MCP facade/helper/手动日志定向回归通过，无跳过；新增 statfs 被设置为抛错时命令仍可完成，以及手动清理只清固定日志、保留状态和用户文件、拒绝符号链接。
- 首轮旧容量拒绝测试失败，因为其预期与新需求冲突；已改为禁止磁盘探测的测试后通过。此前测试覆盖仍是本地/桩环境，不能声称完整 37 工具、真实 SSH、桌面按钮点击、原生 Windows 持久任务全部正常。

- 随后会话全组合 45 项通过、无跳过，覆盖本地非 PTY sh、模拟服务和独立宿主拒绝启动；仍不代表真实 SSH/MCP 或桌面点击验证。
