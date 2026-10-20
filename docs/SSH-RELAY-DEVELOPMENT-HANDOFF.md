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
