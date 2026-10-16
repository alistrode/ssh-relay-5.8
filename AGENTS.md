# 当前公网近远端与 MCP 功能复现

本升级工作分支是 recovery/current-public-relay-pro，基于 recovery/current-public-relay-mcp@4c05038；保留旧中继与既有通道。旧维护分支为 recovery/current-public-relay-mcp，基于已通过 660 秒公网自测的 recovery/current-public-relay-source@22f5614。不得修改或合并 main 或纯源码分支，除非用户明确要求。

连接 Skill、连接辅助程序与操作说明是必要交付物，保留于本分支。不要提交 node_modules、dist、运行包、私钥、连接块、日志或运行状态。讨论应用代码时指向 src/；恢复结果应标注为发布包重建，不冒称原始工程。

连接 Linux/Windows 时读取对应 .agents/skills/connect-*-public-ssh/SKILL.md。技能调用本仓库 src/near.cjs，不能偷偷使用其他目录的旧 bundle。先验证指纹与实际远端身份；云端自测不得冒充用户电脑连接成功。

目标是保留当前公网连接能力，复现稳定版 MCP 的 AI 工具、操作提示和工具链。范围见 docs/MCP-REPRODUCTION.md；未实现的工具不得写成已可用。排除局域网功能；重复或冲突功能须向用户请示。不得修改环境配置或擅自连接用户电脑。

稳定性修复与证据见 docs/MCP-STABILITY-RESULTS.json、docs/MCP-VALIDATION.md。历史单轮通过不能代替新验收；环境中断或不完整记录不算通过。两端均更新并协商 relayProtocol=2 才具备接收端 ACK/重传能力，不能把协议 1 兼容连接说成已修复。near-events.jsonl / far-events.jsonl 仅留私密运行目录，不提交；元数据按 cid/seq 对照，PUBACK 不是接收端交付凭证。

用户最新明确要求交付最小可用包：允许 deliverables/ 下提交脱敏运行 ZIP、源码 ZIP 和校验文件。此例外不允许提交 data/、私钥、连接块、原始日志、node_modules 或散装 dist/。

当前已授权连接断开时，必须执行对应连接 Skill 的“强制重连纪律”：先自行实际重连三次，失败后按 2、4、8、16、30、60 秒指数退避继续恢复，不因普通超时索要密码、新连接块或用户确认。复用已保存身份并严格验证目标；仅重连与只读核验，不重放用户有副作用的操作。

升级必须复用现有公共 broker，不要求用户部署服务器。新近远端状态、会话、端口、进程与旧通道隔离。升级后须完成连续 3600 秒公网测试及免配对故障恢复验证，记录真实平台范围；不能拼接不完整记录。

Pro 新增应用代码位于 src/pro/ 和 desktop/，来源是本次实现，不称为原始工程找回。Pro 使用 Electron 内置 Node 运行时，运行包位于 deliverables/pro/；日志、配对码、私钥及测试状态必须留在仓库外。Pro 使用方式与权限边界见 docs/PRO-MANUAL.md，完成证据见 docs/PRO-VALIDATION.json。

最新用户指令覆盖等待门槛：立即完整上传源码和运行时、补齐真实 Windows 本地文件并登记 ProjectManager；不得因等待一小时延迟该交付。未完成的最终源码一小时仍须如实标注，不能冒称通过。
