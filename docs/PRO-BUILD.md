# 构建 Pro 交付包

本次新增应用实现为 `src/pro/` 和 `desktop/`；其余来源继续按 `MCP-SOURCE-PROVENANCE.json` 区分。Pro 复用现有协议 2，不包含 REA 或逆向工具作为用户运行依赖。

在 Linux x64 构建机需要 Python 3（含 lzma）、Node.js 22+、npm、curl 和 dpkg-deb。输入版本与 SHA256 固定于 `assets/pro-runtime-inputs.json`，包含 Electron 44.8.0 官方 Linux/Windows 发布包和 WinSW 2.12.0。首次准备：

```sh
npm ci --ignore-scripts
python3 scripts/fetch-pro-runtimes.py /private/runtime-cache
python3 scripts/package-pro.py /private/runtime-cache
```

不要删除或替换环境代理、CA 信任，也不要关闭 TLS 校验。构建器只取生产依赖，剔除第三方测试夹具；包内保留上游运行时和依赖许可。Electron 同时提供图形壳和内置 Node.js，后台通过 `ELECTRON_RUN_AS_NODE=1` 运行；远端工具启动包内运行时而不依赖 PATH 中的 Node。该变量不会继承到用户业务命令中。

产物放入 `deliverables/pro/`。Windows 采用 ZIP 包含 XZ 运行时与 Setup.cmd，使用系统自带 tar 解包，避免 GitHub 100 MiB 单文件限制；不偷偷从网络安装 Node。Linux DEB 设置受包管理器所有的 chrome-sandbox 权限；TAR 不更改用户系统沙箱配置。

`resources/app/BUILD-PRO.json` 列出构建时所有 `src/` 应用运行源码的 SHA256，必须与最终一小时验收中的 `sourceHashes` 一致。最终验收 JSON 生成后重建发布包，再生成源码 ZIP 和 `SHA256SUMS`。源码 ZIP 不含 node_modules、运行时、测试凭据、状态或运行日志，完整应用实现及 lockfile 均保留。

测试脚本：`npm run test:pro`、`npm run test:relay`；公网故障恢复见 `tests/pro/public-recovery.cjs`，一小时控制器见 `tests/pro/public-soak.py`。完整 37 工具业务依赖与限制仍以 MCP 手册为准。不得把仅有日志片段或已中断的计时标记为通过。

Windows 开机服务包装器使用 WinSW 2.12.0 的 .NET Framework 4 版本；受支持的 Windows 10/11 自带该框架。包内逻辑文件名为 `vendor/WinSW-x64.exe`，实际上游文件及 SHA256 在运行时来源清单中明确记录；它不是另一份 Node 运行时。

最终运行包生成后执行 `python3 scripts/check-pro-packages.py`，核对三份包的实测应用散列、内置运行时、依赖及 DEB 权限，输出 `deliverables/pro/PACKAGE-CHECKS.json`。将完整项目文件加入 Git 索引后运行 `python3 scripts/package-pro-source.py`，生成完整源码导出及覆盖所有交付文件的 SHA256SUMS；源码清单不包含运行包或私密状态。
