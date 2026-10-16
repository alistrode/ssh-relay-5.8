# SSH Relay Pro：公网近远端、自动重连与 MCP

当前交付状态：用户随后明确要求立即上传完整源码、运行时并登记本地项目管理器，不再等待最终源码的一小时验收。本次按此最新要求交付；PRO-VALIDATION.json 如实保留最终轮次未完成状态，历史 3631 秒通过不能替代最终源码验收。

升级工作分支为 `recovery/current-public-relay-pro`，基于 `recovery/current-public-relay-mcp@4c05038`。沿用已经连通的公共 MQTT 中继与 SSH，新增一次配对、记住设备、后台守护、自动恢复、托盘界面和自启动设置；无需自行部署服务器。新版本使用独立状态与通道，不替换旧版本。没有向 main 推送或合并。

下载和操作请先读 [Pro 说明](docs/PRO-MANUAL.md) 与 [Pro 交付目录](deliverables/pro/README.md)。Pro 的应用代码位于 `src/pro/`、`desktop/`，属于本次新增实现，不能称为找回的原始源码。原有 37 个 MCP 工具、5 个提示词和连接 Skill 保留。

验证以 [Pro 验收记录](docs/PRO-VALIDATION.json) 为准；旧版的 660 秒记录不能代替 Pro 的连续一小时测试。云端 Linux 自测不代表用户电脑、Windows 双击或实际重启验收。

## 源码开发与 Pro 启动

```sh
npm ci --ignore-scripts
node src/pro/cli.cjs start --role near
node src/pro/cli.cjs start --role far
```

图形界面使用 Electron；源码开发环境需准备与 lockfile 一致的 Electron 运行时，再运行 `npm run pro:ui`。交付包已内置 Electron 和 Node 运行时，不需要用户安装 npm/Node。无桌面的 AI 云端使用 CLI，按对应连接 Skill 的 Pro 章节操作。

## 保留的旧版入口

以下是保留的旧版入口和源码使用方法；完整新设备记忆与后台恢复请使用上述 Pro 入口。保留当前 MQTT 公网连接，复现稳定版 MCP SSH Manager 的全部 37 个工具，补齐提示词、连接 Skill 和操作说明；不引入局域网功能。

免安装运行包（内置 Node.js）和桌面图标：见 [下载与双击启动](deliverables/README.md)，Windows、Linux 分开下载。以下 npm 步骤用于源码开发。

## 运行

需要 Node.js 22+。完整仓库根目录：

```sh
npm ci --ignore-scripts
npm start
```

Windows 也可使用 `START-REMOTE.cmd`。远端保持运行，将打印的完整私密连接块交给可信 AI，按 [Windows Skill](.agents/skills/connect-win10-public-ssh/SKILL.md) 或 [Linux Skill](.agents/skills/connect-linux-public-ssh/SKILL.md) 导入。连接块、data/ 和私钥不可上传。

导入得到已核验的私密 connection.json 后，在近端启动 MCP：

```sh
node /absolute/repo/src/mcp.cjs --connection /private/connection.json \
  --name remote --state-dir /private/mcp-state
```

默认提供全部 37 个工具、5 个 prompts 和手册资源，使用 stdio，不自动改客户端配置。多目标、工具选择和客户端配置示例见 [完整操作手册](docs/MCP-MANUAL.md) 与 examples/。

## 功能

命令执行、双向文件传输和同步、持久会话、日志、监控、服务和进程操作、备份还原与计划、三种数据库、部署、提权执行、别名、Profiles、Hooks、分组批量、连接管理、固定指纹、历史及回环端口转发。各平台依赖与行为差异必须按 [功能清单](docs/MCP-REPRODUCTION.md) 和手册判断，不能从工具名称推断可用权限。

远程命令继承远端进程权限，Windows 管理员启动可传递提升令牌，不能突破所有系统文件保护。详见 [权限说明](docs/PERMISSIONS.md)。当前远端新增 SFTP 属性修复、进程树终止和回环转发；旧远端仍可提供原有命令/SFTP，但新增能力需停止旧实例后启动新版。

公网稳定性修复采用接收端确认、丢包重传与发送节流；近远端都需更新并确认协议 2 才生效。日志位置、升级及断线处理见 [连接排查](docs/troubleshooting.md)。

## 来源与验证

源代码来源见 [来源清单](docs/MCP-SOURCE-PROVENANCE.json)，稳定版辅助模块按 MIT 许可保留。当前实现和旧连接层分别处理，不将重建或新适配代码冒称原始工程。

验证结果与明确限制见 [验证说明](docs/MCP-VALIDATION.md)。`npm run build` 只生成被忽略的派生 dist/，不提交运行包、依赖目录、测试状态或凭据。
