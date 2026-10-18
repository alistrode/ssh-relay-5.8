# SSH Relay Pro 2.0.1 修复候选

当前仍未通过最终双平台验收。包的结构、52 个运行源码文件散列、内置运行时和生产依赖检查通过，不代表 Windows GUI、连接切换或一小时验收已经通过。实际范围见 `VALIDATION.json` 与 `docs/PRO-STARTUP-VALIDATION.json`。

- `ssh-relay-pro-windows-x64.zip`：Windows 10 1803+ / Windows 11 x64。解压后运行 `Setup.cmd`，再从单一应用目录启动；`Start.cmd` 默认通过 Windows UAC 请求管理员启动，取消则停止。`Diagnostics.cmd` 离线导出脱敏诊断，不要求提权。完整运行时与生产依赖已内置，无需系统 Node/npm。
- `ssh-relay-pro-linux-amd64.deb`：Linux x64，需支持包声明的系统桌面库。安装包提供由包管理器设置所有者的 Chromium 沙箱。
- `ssh-relay-pro-linux-x64.tar.xz`：Linux x64 单文件夹运行包；系统需具备声明的桌面库和受支持的用户命名空间沙箱。
- `source.zip`：该候选的完整项目源码、测试、依赖清单和构建说明；`SOURCE-MANIFEST.json` 记录源码提交与文件散列。

升级采用独立身份、配置目录和中继会话。先探测占用，再发起 SSH；其他控制器占用时拒绝抢占，并由远端决定是否切换。批准后，已有命令、已打开文件句柄和 TCP 转发继续完成，新操作交给新控制器。不重放业务写入，不关闭指纹或 TLS 检查。

配对状态、私钥、连接报告和原始日志不随交付包上传。旧的 2.0.0 记录，以及 `repair-2.0.1` 中更早的源码快照，不作为当前包的通过证明。
