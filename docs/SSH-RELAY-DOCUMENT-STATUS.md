# SSH 文档有效性与排除清单

审查日期：2026-10-20（北京时间）。适用分支：`fix/ssh-pro-startup-20261019`。

本清单排除的是文档作为当前开发指令、进度或最终用户流程的资格，不删除历史证据，也不废除凭据保护、身份校验、授权边界和不得盲目重放写入等约束。不能仅按文件日期判断：自动上传会更新交接时间，旧设计也可能仍保存完整有效目标。

## 当前开发入口

| 文档 | 使用范围与处理 |
| --- | --- |
| SSH-RELAY-DEVELOPMENT-HANDOFF.md | 当前进度入口。此前漏写完整目标，已补回配对码、简单接口/Skill、软件内部流程与五主机隔离；局部实现不得冒称整体完成。 |
| SSH-RELAY-END-TO-END-DESIGN.md | 经最新交接引用的完整目标与技术设计。第 3、9、11 节仍有效；“所有新文件尚未实现”的状态概述已纠正为部分实施。设计中的未实现接口不代表已有功能。 |
| SSH-RELAY-FORMAL.md | 仅为本轮槽位/异步发现的有界证明记录。已补完整目标引用，不作为完整产品目标或全系统通过证明。 |
| SSH-RELAY-DOCUMENT-STATUS.md | 本排除清单；不新增实现或验收结论。 |

## 排除为当前交接或正常接入依据

| 文档 | 可疑或已过期证据 | 保留范围 |
| --- | --- | --- |
| PRO-HANDOFF.md | 同时存在“main 为主线”的补充和“必须 recovery、禁止 main”的旧限制；还包含历史工作区和电脑状态。 | 历史交付与安全说明，不能据其切分支或假定远端状态。 |
| troubleshooting.md | 要求读取本分支已不存在的 connect-* Skill、导入完整连接块并由 AI 管理内部日志/近端。 | 历史协议与故障现象；旧操作流程排除。 |
| PRO-REPAIR-PROGRESS.md | 是 Windows 启动修复的多阶段累积记录，开头和后续追加的验证范围不同；不包含本轮完整整合进度。 | 历史故障证据与未覆盖平台事项，不能直接作为当前任务清单。 |
| SSH-RELAY-CONTINUE-DEVELOPMENT.md | 仅几行分工提纲，未承载简单入口目标；“需要配置定时任务”早于本轮已启动上传进程的记录。 | 工作方向参考，不作为当前状态或常驻进程存活证据。 |
| README.md | 仍把 recovery/current-public-relay-pro 作为升级工作分支，以旧 PRO-VALIDATION.json 描述交付，要求取得报告后启动 MCP。 | 仓库背景/旧交付入口；不能指导本轮整合或替代最新交接。此次未重写 README。 |
| .agents/skills/ssh-relay-pro/SKILL.md | 仍要求 AI 选择状态目录、取 connectionReport、启动 MCP、核对内部日志及触发 retry；属于旧版兼容操作。 | 不作为最终简单 Skill 的设计依据；其中身份、隐私、授权与不重放约束继续保留。此次未执行或重写该 Skill。 |

## 保留为兼容、构建或历史证据

| 文档 | 当前限定 |
| --- | --- |
| PRO-MANUAL.md | 旧 2.0 使用说明，开头仍指定 recovery；配对与 GUI 资料可核对源码参考，旧路径/报告操作不能变成最终 AI 接入要求。 |
| MCP-MANUAL.md | 保留现有工具参数/业务边界参考；手工报告与旧 Skill 接入部分仅兼容。 |
| PRO-BUILD.md | 构建方式参考，不证明当前源码或包通过运行；使用前核对实际脚本及固定输入。 |
| PERMISSIONS.md | 账户/令牌/权限边界参考；旧 START-REMOTE、连接块及“不请求 UAC”等具体启动描述需与当前代码核对，不能直接执行历史流程。 |
| MCP-REPRODUCTION.md | recovery 阶段功能与来源范围记录，不证明当前分支所有功能已回归。 |
| MCP-SOURCE-PROVENANCE.json | 来源与许可资料，不是进度；保留。 |
| PRO-VALIDATION.json | 明确记录应用 2.0.0、历史 recovery 分支和未完成状态，不能覆盖当前源码。 |
| PRO-STARTUP-VALIDATION.json | 2.0.1 启动候选快照，包含 null/未完成项；不作为后续整合源码或整机验收。 |
| MCP-VALIDATION.md、MCP-VALIDATION-SUMMARY.json、MCP-STABILITY-RESULTS.json | 早期工具/公网验证历史，只证明各自记录的范围；不得直接套用到本轮源码。 |

## 本次处理与下一步

已给最易误用的六份旧文档加顶部说明：PRO-HANDOFF、troubleshooting、PRO-REPAIR-PROGRESS、SSH-RELAY-CONTINUE-DEVELOPMENT、PRO-MANUAL、MCP-MANUAL；修正最新交接、设计状态和形式化报告的目标范围。未删除或移动历史文件，未修改应用源码，未运行应用验证。

下一步仍从最新交接继续，先围绕“给码/简单接口 → 原工具 → 软件内部完成状态与恢复”补齐实现和形式化模型。现有 `--agent-dir` 适配只是阶段机制，不能以此宣布已经消除 AI 的目录/连接管理负担。
