> 文档状态（2026-10-20）：旧版/兼容操作参考：recovery 分支、安装路径和连接报告步骤不作为当前整合版本的最终接入设计；接口事实需核对源码，不能据此声称当前包可用。见 SSH-RELAY-DOCUMENT-STATUS.md。

# SSH Relay Pro 2.0

工作分支：`recovery/current-public-relay-pro`。基线：旧维护分支 `recovery/current-public-relay-mcp@4c05038`。本版本在现有公共 MQTT WebSocket 中继上升级 SSH 管理；没有新增需要购买或部署的服务器，也没有接入局域网发现、Tailscale 或其他传输。公共 broker 仍有第三方可用性限制，设备断电或系统休眠时不能凭空保持在线。

## 第一次连接

两端均使用 Pro 包。Windows 解压 ZIP 后双击 `Setup.cmd`，它调用 Windows 自带 tar 解包到 `%LOCALAPPDATA%\SSHRelayPro`，再启动 `SSHRelayPro.exe`。要求 Windows 10 1803+ 或 Windows 11 x64。Linux 推荐安装 DEB 后在应用菜单打开；TAR 解压后双击原生 `ssh-relay-pro`，不需要把 `.desktop` 交给文件关联程序。Linux 需要常规图形桌面及 Electron 系统库，TAR 运行依赖系统支持 Chromium 用户命名空间沙箱；不通过关闭系统沙箱解决安装问题。

远端打开“让这台电脑被连接”，点击“生成一次性配对码”。近端在“连接我的电脑”输入短码，点击“配对并记住”。近端也可为无桌面的云端 CLI。配对码有效期五分钟、单次使用；可复制或主动取消。成功后保存设备授权、SSH 私钥和固定主机身份，下次不必复制新的连接块。远端必须保持运行；仅重开界面不应重新配对。

同一界面提供近端和远端两部分，两者后台独立；只需启用自己要用的角色。设备列表可选择默认电脑、暂停自动连接、立即重试或本地取消配对。近端“取消配对”仅删除本地记录；若要真正禁止该近端访问，在远端“已授权”列表撤销授权。撤销会断开此远端现有会话，之后必须明确重新配对。

设备目录默认 `~/.ssh-relay-pro`，Windows 对应用户主目录。不要删除该目录来修普通断线，否则会丢失身份。程序升级保持安装路径和设备目录，不与旧 `data/`、旧连接块混用。旧版通道不会被停止，也不会被 Pro 的“停止后台”操作终止。

## 自动恢复的实际行为

保存并启用的电脑会自动连接。MQTT、近端 worker、SSH 身份探测和 MCP 连接均有恢复流程：先三次无额外退避的尝试；失败后等待 2、4、8、16、30、60 秒，此后等待最多 60 秒继续尝试。每次正常握手本身需要时间，不能把“无额外退避”理解为零秒完成。没有要求用户输入密码的回退。目标身份不符、授权已撤销时不会关闭指纹校验来强行连接。

独立守护进程负责自动重启意外退出的 Agent；Agent 又负责自己的 worker。关闭窗口只隐藏到托盘。托盘“退出界面，保留后台连接”会退出 GUI，后台继续；“停止本版本后台并退出”明确停止 Pro 自己的守护及 Agent。若整个系统重新启动，需要先开启相应自启动方式。

断网可能使旧 SSH shell、传输或端口转发终止；自动恢复建立的是新的可信连接，不承诺续接旧字节流或恢复进程上下文。后台和 MCP 只重建连接、做只读身份检查，不重放命令、部署、删除、上传或数据库导入。连接恢复后先核对旧操作实际结果，再决定下一步。工具提示词的 `remote-recover` 与连接 Skill 仍必须遵守这一规则。

## 自启动与权限

界面“自动启动”切换后立即保存；也可按“应用设置”。界面分别显示希望的设置和检测到的系统注册结果。

- 登录后启动：无需提权，登录当前桌面账户后显示托盘并启动后台。Linux 注册当前用户 XDG autostart，Windows 注册当前用户 Startup 快捷方式。
- 开机启动后台：首次需要系统管理员授权。Linux 安装带当前 UID 的 near/far systemd 单元，仍以当前账户运行。Windows 使用包内 WinSW 安装 near/far 服务，明确使用 LocalSystem；GUI 会先说明权限和目录区别。登录后另启动普通用户托盘。
- 关闭自启动只改变后续启动行为，不立即断开现有连接；需要停止时使用明确的后台停止操作。拒绝系统授权不会被写成已启用。

Windows 服务不是桌面交互会话；SYSTEM 的用户目录、网络盘、凭据和权限均与桌面账户不同。不要用“权限更高”推断业务路径一定兼容。普通桌面启动继承当前账户；需要管理员操作时使用用户明确授权的管理员启动。没有修改 UAC、系统 ACL 或绕过系统权限边界。

## 无桌面 CLI 与 MCP

Linux 包自带 `relay-cli` 与 `mcp`；Windows 包自带 `relay-cli.cmd` 与 `MCP.cmd`。以下源码命令中的 `node src/pro/cli.cjs` 可替换为对应包的 CLI：

```sh
node src/pro/cli.cjs start --role near
node src/pro/cli.cjs pair --role near --code-file /private/code.txt
node src/pro/cli.cjs devices --role near
node src/pro/cli.cjs retry --role near
node src/pro/cli.cjs logs --role near
```

`--code-file` 放在仓库外，权限 0600；不把配对码放入进程命令行或聊天日志。远端可用 `pair-code --role far` 私下获得配对信息，输出属于凭据，不可上传。`--state-dir /private/profile/near` 可指定 CLI 角色目录；GUI 则用 `--profile-dir /private/profile` 指定同时包含 near/far 的根目录。`status` 只查询，不会偷偷启动；`start` 才启动后台。CLI 不自动安装系统自启动。

配对后 `devices` 返回每台设备的 `connectionReport` 路径。先核对固定指纹、`remote_hostname`、`remote_user` 和 `cloud_self_test`，再将该私密报告用于 MCP：

```sh
node src/mcp.cjs --connection /private/profile/near/devices/DEVICE/connection.json \
  --name my-computer --state-dir /private/mcp-state
```

实际路径以 `devices` 输出为准，不猜 DEVICE。交付包用 `./mcp --connection ...` 或 `MCP.cmd --connection ...`，使用包内 Node 运行时。stdio 只承载 MCP 协议；不自动修改 AI 客户端环境配置。37 个工具、5 个提示词及服务端资源见 [完整 MCP 手册](MCP-MANUAL.md)。配对没有减少工具数；数据库仍需要目标机真实数据库客户端/服务，计划任务仍需要系统调度器。不能把参数校验测试说成真实业务通过。

客户端 JSON 示例见 `examples/pro-client-linux.json`、`examples/pro-client-windows.json`。将用户名、实际安装目录和 `devices` 返回的报告路径替换为本机值；客户端通常不会替你展开路径里的环境变量。Windows 客户端直接启动内置 EXE 并为该子进程设置 Node 模式，避免直接 spawn `.cmd` 的兼容问题。这里的进程环境设置不更改系统环境或 PATH。

无图形界面的云端可启动 near 后台、输入远端配对码并运行 MCP；托盘只在有桌面的电脑上有意义。云端只要保留自己的私密状态即可自动重连同一台已授权电脑。云端工作区被销毁会丢失本地身份，平台没有持久盘时不能承诺跨工作区保留授权。

## 日志与诊断

每个 near/far 角色目录有 `guardian-events.jsonl`、`agent-events.jsonl` 和 worker 中继事件；轮转限制与原有中继事件一致，元数据日志每份 2 MiB、三份备份。界面展示近远端事件，导出压缩脱敏诊断。记录重连次数、等待、身份验证阶段、会话关闭原因等；不记录配对码、私钥、Bearer token、命令或文件内容。设备标签、主机身份和本地路径仍属于个人信息；不要公开原始日志。`bootstrap.log` 用于启动失败定位，不应公开上传。

诊断先分清公共 broker 断开、对端离线、交付 ACK 超时、连接容量（最多八条并行 SSH）、SSH 认证及业务命令失败。broker PUBACK 不是另一端交付确认。协议 2 保留接收端 ACK、重传、乱序去重和节流，不能将旧协议 1 连接算作升级完成。

## 隔离调试与验收边界

测试使用仓库外的独立 profile、随机中继会话、独立主机和近端密钥、动态回环端口及自己的进程。不得停止未知进程、接管旧 profile 或改变用户现有信道。本次云端自测须显式 `--allow-cloud-self-test`，报告标注为云端自身；真实连接用户电脑禁止用此标志消除身份判断。

验收证据见 `PRO-VALIDATION.json`：一小时持续及空闲 SSH、真实 SSH/SFTP/MCP、并发及故障恢复分别记录。中途修改应用运行源码必须重新计时，未完成轮次不计通过。Linux 云端图形冒烟不能替代真实 Linux 桌面托盘与系统重启。另已完成 Windows 原生运行时、界面渲染、关闭界面后台继续、MCP、1 MiB 文件往返和 Agent 崩溃自动恢复检查；使用同一应用源码与锁定官方运行时在独立目录组装。下载 ZIP 的 Setup.cmd 双击、物理托盘菜单点击与开机重启仍未实测。以证据列明的范围为准。

Windows 开机服务包装器使用 WinSW 2.12.0 的 .NET Framework 4 版本；受支持的 Windows 10/11 自带该框架。包内逻辑文件名为 `vendor/WinSW-x64.exe`，实际上游文件及 SHA256 在运行时来源清单中明确记录；它不是另一份 Node 运行时。
