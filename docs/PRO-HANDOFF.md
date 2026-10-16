# 接手 Pro 工作分支

当前交付状态：用户随后明确要求立即上传完整源码、运行时并登记本地项目管理器，不再等待最终源码的一小时验收。本次按此最新要求交付；PRO-VALIDATION.json 如实保留最终轮次未完成状态，历史 3631 秒通过不能替代最终源码验收。

仓库：`https://github.com/trlstdin/rororororo`，必须使用私有分支 `recovery/current-public-relay-pro`。禁止向 main 推送、合并或切换到 main 开发。基线旧维护分支为 `recovery/current-public-relay-mcp@4c05038`，本次应用版本 2.0.0。交付提交号以实际分支 HEAD 和本次交付回复为准。

阅读顺序：AGENTS.md、README.md、docs/PRO-MANUAL.md、docs/PRO-VALIDATION.json、deliverables/pro/README.md、对应连接 Skill、docs/MCP-MANUAL.md。

## 项目与交付

- 继续使用现有公共 MQTT 中继承载 SSH，无需用户部署服务器；不增加局域网功能。
- `src/` 与 `desktop/` 是应用实现；Pro 是本次新增实现，不能称为找回的原始源码。来源见 MCP-SOURCE-PROVENANCE.json。
- 保留全部 37 个 MCP 工具、5 个提示词、连接 Skill 和操作说明。数据库真实业务和系统调度注册没有完成服务验收，不能从工具名称覆盖推断业务全部通过。
- 两平台 Pro 包均含运行时与生产依赖。Linux 提供 DEB 与原生 ELF 可移植包；Windows 提供 ZIP + Setup.cmd。源码 ZIP、校验文件和脱敏验收记录都在 deliverables/pro/。
- 运行包内 `BUILD-PRO.json` 的应用运行源码散列必须与一小时验收 `sourceHashes` 一致。不要把缺失组件、仅建议或不完整测试当成交付完成。

## 已保存设备与当前电脑

Pro 用一次性配对码建立持久授权，保存后不得因普通断线反复索要新配对码、连接块或密码。程序包含三次恢复尝试及后续指数退避、独立 guardian、worker/SSH/MCP 恢复；严禁自动重放部署、写入和数据库导入。先检查旧操作结果，再继续工作。

本次还在用户真实 Windows 上部署了独立 Pro，源码和运行时放在 `%LOCALAPPDATA%\SSHRelayPro-Preview`，已配对数据使用标准 `%USERPROFILE%\.ssh-relay-pro`。桌面 `SSH Relay Pro 2.0` 图标指向该版本及标准配置目录。开机启动设置仍由用户在界面选择；没有通过调试擅自注册系统服务或更改环境配置。

如接手的是同一云端工作区，已有真实 Windows 的 Pro 近端角色目录为 `/workspace/relay-pro-validation/user-win-pro/near`。先用本分支 CLI 的 `devices --role near --state-dir ...` 取得报告，再严格核验指纹、whoami、hostname、平台和 `cloud_self_test`。目录名含 validation 不代表目标是云端自身；以实际身份核验为准。此目录是私密运行状态，绝对不能加入 Git，也不能承诺它会出现在新工作区中。

旧版远端和旧近端另行保留，不能拿旧打印块覆盖 Pro 身份。没有确认归属时不终止进程、不改端口、不停止其他通道。旧通道曾离线，已使用原程序与原身份恢复；其身份与 Pro 独立，不把它冒称协议 2。

## 验证与后续修复

最终连续一小时结果以 PRO-VALIDATION.json 为准，不能拼接已中断轮次。云端 Linux 一小时、并发、故障恢复及 54 次 MCP 调用，与 Windows 独立实机检查分别记录。Windows 已检查原生运行时、界面渲染、MCP、1 MiB 文件往返、GUI 退出后两端后台继续及 Agent 崩溃免配对恢复；下载 ZIP 的 Setup.cmd 双击、物理托盘菜单点击和实际开机重启尚未验收。

真实电脑身份、连接块、密钥、Bearer token、配对码和原始日志都不上传。故障注入只能作用于明确独立、明确授权的实例。修复后同步应用实现、运行包、源码 ZIP、说明与校验值，完成相应验证再推送本分支。
