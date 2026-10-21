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
