> 升级版一次配对、自动重连与托盘界面请使用 [Pro 交付包](pro/README.md)。以下保留原维护版本。

# 下载与双击启动

Linux 图标被 Vim 打开：下载 **linux-launcher-fix.tar.gz** 小补丁，解压覆盖到上一版已经内置 Node 的 Linux 远端目录，再双击 **SSH-Remote（无扩展名）**。该原生入口不依赖 .desktop/.sh 的文件关联，也不修改默认编辑器。已有私密 data/ 不在补丁中，不删除。新下载优先使用下方完整 TAR 包。

- **remote-windows-x64.zip**：Windows 10/11 x64。已内置官方 Node.js 22，完整解压后双击 **SSH-Remote.lnk** 或 **START-REMOTE.cmd**，会创建带自定义图标的桌面快捷方式。
- **remote-linux-x64.tar.gz**：Linux x64（glibc 2.28+），优先下载此文件以保留执行权限。完整解压后双击 **SSH-Remote（无扩展名）**，它是原生 ELF 程序，绕开 .desktop/.sh 被 Vim 当文本打开的问题。首次启动创建桌面原生启动链接，同时添加应用菜单入口。不要再点击旧的 .desktop 图标。也提供同内容的 ZIP；若文件系统禁止执行，需在属性中允许执行。
- **source.zip**：完整工程源码，含 MCP、提示词、连接 Skill、启动器、图标和打包程序；源码开发才需要 npm ci --ignore-scripts。
- **SHA256SUMS**：下载文件校验；**NODE-RUNTIME-PROVENANCE.json**：内置 Node 官方版本与下载校验值；**PORTABLE-CHECK.json**：平台检查范围。

上面两个远端包均不需要另装 Node.js 或 npm。必须先完整解压，不能在 ZIP 内直接启动。启动后保持窗口开启，把完整私密连接块交给可信 AI。不要移动或删除解压目录，桌面图标会引用它。两端均更新并核对协议 2；运行后生成的 data/ 含私钥，绝不能上传。

应用代码来自已完成 660 秒公网验收的 4853832。Linux 内置运行时与原生启动器通过云端公网 SSH 实测；Windows 官方运行时和快捷方式做静态检查，未声称 Windows 实机双击验证。MCP 的完整工程在源码包中；这两个独立运行包用于当前近远端连接。

near-far-minimal.zip 是之前不含 Node 的旧包，保留供已有运行环境使用；现在优先下载带明确平台名称的新包。

重新打包：安装开发依赖后先运行 python3 scripts/package-minimal.py，再运行 python3 scripts/package-portable.py。后者从 nodejs.org 下载 assets/node-runtime-inputs.json 固定的官方文件并校验 SHA-256，缓存于被忽略的 .node-runtime-cache/；也可传入缓存目录作为第一个参数。
