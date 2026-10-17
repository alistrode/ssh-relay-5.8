# SSH Relay Pro：公网近远端、自动重连与 MCP

当前交付状态：用户随后明确要求立即上传完整源码、运行时并登记本地项目管理器，不再等待最终源码的一小时验收。本次按此最新要求交付；PRO-VALIDATION.json 如实保留最终轮次未完成状态，历史 3631 秒通过不能替代最终源码验收。

升级工作分支为 `recovery/current-public-relay-pro`，基于 `recovery/current-public-relay-mcp@4c05038`。沿用已经连通的公共 MQTT 中继与 SSH，新增一次配对、记住设备、后台守护、自动恢复、托盘界面和自启动设置；无需自行部署服务器。新版本使用独立状态与通道，不替换旧版本。本次仓库整理已将 Pro 提升为 main，并保留原维护分支。

下载和操作请先读 [Pro 说明](docs/PRO-MANUAL.md) 与 [Pro 交付目录](deliverables/pro/README.md)。Pro 的应用代码位于 `src/pro/`、`desktop/`，属于本次新增实现，不能称为找回的原始源码。原有 37 个 MCP 工具、5 个提示词和连接 Skill 保留。

验证以 [Pro 验收记录](docs/PRO-VALIDATION.json) 为准；旧版的 660 秒记录不能代替 Pro 的连续一小时测试。云端 Linux 自测不代表用户电脑、Windows 双击或实际重启验收。

## 仓库版本导航

`main` 维护 SSH Relay Pro 2.0。以下 1.0～4.0 是分支分类编号，不改变应用自身版本号。

| 分支 | 内容 |
|---|---|
| [versions/1.0](https://github.com/trlstdin/rororororo/tree/versions/1.0) | 原始 MCP SSH Manager 3.8.5；仅确认近端原始源码 |
| [versions/2.0](https://github.com/trlstdin/rororororo/tree/versions/2.0) | 纯公网中继近远端源码 |
| [versions/3.0](https://github.com/trlstdin/rororororo/tree/versions/3.0) | 公网中继 + MCP |
| [versions/4.0](https://github.com/trlstdin/rororororo/tree/versions/4.0) | SSH Relay Pro 2.0，与本次整理后的 main 相同 |
| [archive/main-before-pro-20261017](https://github.com/trlstdin/rororororo/tree/archive/main-before-pro-20261017) | 切换前 main 的完整快照 |

当前只保留两个 skills：[Pro 连接](.agents/skills/ssh-relay-pro/SKILL.md) 与 [工作区、备份及开发](.agents/skills/workspace-backup-dev/SKILL.md)。原两个连接 skills 及其旧附件已删除；原备份和工作区规范已合并。历史版本仍可从原分支及 Git 历史查阅。

## 源码开发与 Pro 启动

```sh
npm ci --ignore-scripts
node src/pro/cli.cjs start --role near
node src/pro/cli.cjs start --role far
```

图形界面使用 Electron；源码开发环境需准备与 lockfile 一致的 Electron 运行时，再运行 `npm run pro:ui`。交付包已内置 Electron 和 Node 运行时，不需要用户安装 npm/Node。无桌面的 AI 云端使用 CLI，按对应连接 Skill 的 Pro 章节操作。

## AI 连接与开发规范

连接统一使用 [SSH Relay Pro skill](.agents/skills/ssh-relay-pro/SKILL.md)：优先复用已配对电脑，首次才使用一次性配对码，取得真实 connectionReport 后启动 MCP 并核验身份。Windows/Linux 桌面及无桌面近端均支持，不限云端。

项目整理与代码修改遵循 [工作区、备份与开发 skill](.agents/skills/workspace-backup-dev/SKILL.md)，优先已有 xxm，保留配对目录并在修改代码前备份。

工具操作见 [MCP 手册](docs/MCP-MANUAL.md)，Pro 操作见 [Pro 手册](docs/PRO-MANUAL.md)。旧连接块入口不再作为本分支 skill 提供；历史材料从归档或旧版本分支读取，不与 Pro 状态混用。

本次仅更新仓库 skills、文档与包校验兼容逻辑，未重新构建已发布运行包或源码 ZIP；它们仍是历史交付快照，内嵌 skills 可能较旧。当前规则以本仓库 main 为准。
