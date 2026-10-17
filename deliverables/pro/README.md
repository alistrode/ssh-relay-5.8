> 仓库整理更新（2026-10-17）：用户已明确授权 Pro 成为 main；当前开发主分支为 main，版本分类分支为 versions/4.0。下文关于禁止修改 main、仅在 recovery 分支开发的历史限制不再适用于本次整理及后续 main 维护。其他连接、安全和验收要求保留。旧 main 已完整归档至 archive/main-before-pro-20261017。

# SSH Relay Pro 2.0 私有交付

当前交付状态：用户随后明确要求立即上传完整源码、运行时并登记本地项目管理器，不再等待最终源码的一小时验收。本次按此最新要求交付；PRO-VALIDATION.json 如实保留最终轮次未完成状态，历史 3631 秒通过不能替代最终源码验收。

工作分支 `recovery/current-public-relay-pro`。不要切换 main；这些是 Pro 包，原维护版本的包仍保留在上一级目录。新旧版本的状态和通道隔离。

| 平台 | 下载文件 | 打开方式 |
| --- | --- | --- |
| Windows 10 1803+ / 11 x64 | [Windows Pro ZIP](ssh-relay-pro-windows-x64.zip) | 解压后双击 `Setup.cmd`，安装并打开原生 GUI |
| Linux x64，Debian/Ubuntu | [Linux Pro DEB](ssh-relay-pro-linux-amd64.deb) | 用系统包安装器安装，应用菜单启动 |
| Linux x64，可移植 | [Linux Pro TAR.XZ](ssh-relay-pro-linux-x64.tar.xz) | 解压，双击无扩展名原生 `ssh-relay-pro` |
| 应用源码与构建说明 | [Pro 源码 ZIP](source.zip) | 源码开发需要依赖安装；不是双击包 |

两平台包含 Electron 与内置 Node.js 24，无需另装 Node/npm。Linux 仍需常规桌面系统库；TAR 依赖系统用户命名空间沙箱支持。Windows 解包只使用系统自带 tar.exe，不下载运行时。系统服务包装器仅 Windows 使用包内 WinSW。

完整操作见 [Pro 手册](../../docs/PRO-MANUAL.md)，验证范围见 [验收记录](../../docs/PRO-VALIDATION.json)。校验：`sha256sum -c SHA256SUMS`；运行时来源见 `RUNTIME-PROVENANCE.json`。Windows 已在独立目录以相同应用源码和锁定运行时完成实机连接、MCP、1 MiB 文件往返、界面渲染及后台崩溃恢复检查。下载 ZIP 的 Setup.cmd 双击、物理托盘菜单点击及系统重启未实测。

程序设置、配对授权和日志不在下载包里。它们保存在当前用户 `.ssh-relay-pro`，不可上传公开仓库。原始源码、发布包重建代码和本次新增应用代码的来源须按仓库来源说明区分。

Windows 开机服务包装器使用 WinSW 2.12.0 的 .NET Framework 4 版本；受支持的 Windows 10/11 自带该框架。包内逻辑文件名为 `vendor/WinSW-x64.exe`，实际上游文件及 SHA256 在运行时来源清单中明确记录；它不是另一份 Node 运行时。
