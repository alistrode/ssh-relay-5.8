# 公网 SSH 近远端

主分支仅维护当前 `SSH_RELAY_CONNECT` 方案。AI 近端通过公网中继连接 Linux 或 Windows 远端，直接使用 SSH；不依赖 MCP SSH Manager 或 Cloudflare。

| 路径 | 用途 |
|---|---|
| `.agents/skills/connect-linux-public-ssh/` | Linux 连接 skill、Python 导入程序和近端 `near.cjs` |
| `.agents/skills/connect-win10-public-ssh/` | Windows 连接 skill、Python 导入程序和近端 `near.cjs` |
| `remote/linux/`、`remote/win10/` | 从当前发布包原样展开的远端 JavaScript、启动脚本、许可和验证记录 |
| `downloads/` | 含 Node 运行时的完整远端包、可导入的 skill 包、Linux 桌面入口及 SHA-256 |
| `scripts/verify-release.py` | 校验发布包、源码副本和 skill 包的一致性 |

## 使用

1. 从 `downloads/` 下载对应远端包并完整解压。Linux x64 运行 `bash start.sh`；Windows x64 双击 `START.cmd`。运行包已含 Node。
2. 将远端打印的完整连接块交给可信 AI；AI 按对应 `.agents/skills/` 中的 `SKILL.md` 连接。近端需要 Python 3.10+、Node.js 22+ 和 OpenSSH。
3. 核验主机指纹和实际远端身份后执行任务。连接期间保持远端窗口运行。

运行后生成的 `data/` 含凭据，不提交 Git。连接块、私钥、日志和导入状态均不属于源码。

## 源码与运行包

近端可执行源码位于 skill 的 `scripts/`；远端可执行 JavaScript 位于 `remote/<平台>/app/start.cjs`。这些 `.cjs` 是包含依赖的打包源码，目前未找到生成它们的原始模块工程和构建配置；不将旧 MCP SSH Manager 冒充其源码。

`remote/` 为可审阅副本，不重复展开 Node 二进制。直接运行请使用 `downloads/` 完整包。修改 skill 或远端文件后，须同步对应发布包和 `downloads/SHA256SUMS.txt`。

验证：`python3 scripts/verify-release.py`。当前仓库整理只做完整性与语法检查；没有重新执行所有平台端到端测试。包内 `VALIDATION.json` 是原有发布验证记录。

## 历史归档

旧 MCP SSH Manager、Cloudflare 方案、恢复压缩包及无关附件保存在分支 [`archive/legacy-mcp-ssh-manager-2026-10-16`](https://github.com/trlstdin/rororororo/tree/archive/legacy-mcp-ssh-manager-2026-10-16)。主分支中不再保留这些历史目录；Git 历史仍可追溯。
