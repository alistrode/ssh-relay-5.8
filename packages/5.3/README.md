# SSH Relay Pro 5.3 Windows x64

当前 Windows 10 / 11 x64 修复包；不代表已更新正在运行的远端。

- 源码分支：`5.3`
- 配对修复源码提交：`2565f9426255380ede6596c769b37ffa7cc31abb`
- 文件：`SSHRelayPro-5.3-win32-x64.zip`（179834906 字节）
- SHA256：`3afe022aec09de4eb26e3bfcc78b9089aa9713d128005dcf10d644c80a82cb02`
- 保留原 Windows 运行时，更新配对实现及界面；具体文件校验见包内 `PAIRING-FIX.json`。

完整解压后双击 `Start.cmd` 或 `SSHRelayPro.exe`。保留整个文件夹。

压缩包通过 Git LFS 存储在本分支。可在 GitHub 文件页面点击下载原始文件；使用 Git 克隆时执行 `git lfs pull` 获取完整包。未包含开发缓存或用户设备凭据。

## Linux x64 完整运行包

- 文件：`SSHRelayPro-5.3-linux-x64.tar.gz`（Git LFS）
- 校验：同目录 `.sha256`；包内 `BUILD.json` 记录源码提交和运行时来源。
- 内置 Node.js 24.19.0、Electron 44.8.0、生产依赖、Agent、CLI、MCP 和桌面客户端，无需安装 Node/npm。
- Linux x86_64，glibc 2.28+；桌面入口还需要 Electron 系统库及桌面会话。

```sh
tar -xzf SSHRelayPro-5.3-linux-x64.tar.gz
cd SSHRelayPro-5.3-linux-x64
./Start.sh                    # 云端启动后台，无需桌面
./CLI.sh devices
./CLI.sh connect --args-stdin # 从标准输入提供连接参数 JSON
./MCP.sh                      # MCP stdio 入口
./Start-Desktop.sh            # 有 Linux 桌面时打开客户端窗口
```

CLI/MCP 可用 `--state-dir /绝对路径` 指定已有 near 授权目录。不要把授权目录放进交付包。

复现构建：安装生产依赖（`npm ci --omit=dev`），准备官方 Node.js v24.19.0 Linux x64 tar.xz、同版本 SHASUMS256.txt 及 `assets/pro-runtime-inputs.json` 固定的 Electron Linux ZIP 后执行：

```sh
python3 scripts/package-linux-5.3.py /path/to/runtime-cache /path/to/empty-staging-parent
```

验证范围见 `LINUX-VALIDATION.json`。云端未提供桌面会话，图形界面不计入实际运行验收。

## 配对码规则

每个码自生成起独立有效 24 小时，可供多个近端配对。配对成功、生成新码不使旧码失效。后台恢复原码时沿用原到期时间，不重新计时；已取消提前作废入口。设备离线时不能完成握手，重启后仍在有效期的码会恢复。每端仍最多同时连接五台。

有效码保存在远端私有状态目录 `pair-invitations-private.json`，不要删除授权目录或把它打进运行包。旧版已消费并丢弃的码无法从新程序还原；升级后生成的码遵守以上规则。

Windows 命令任务以进程级脚本策略启动任务执行器，不修改系统全局执行策略；已在实际 Windows SYSTEM 后台验证命令执行成功。
