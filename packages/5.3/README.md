# SSH Relay Pro 5.3 Windows x64

此包与实际部署到两台电脑的修复包完全一致，适用于 Windows 10 / 11 x64。

- 源码分支：`5.3`
- 包内源码提交：`ae8ca366eddd0cf934e3d0327fe286f991c0dae8`
- 文件：`SSHRelayPro-5.3-win32-x64.zip`（198056469 字节）
- SHA256：`4858023229d49e86404f0c322699c493a0be2affcf27a82f2b8b5b95f4f65465`

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
