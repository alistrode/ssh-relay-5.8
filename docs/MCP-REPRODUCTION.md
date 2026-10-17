# MCP 功能复现范围

工作分支 recovery/current-public-relay-mcp。全部 37 个工具已接入真实 stdio MCP，保留当前 MQTT 公网近远端；提供 5 个工作流 prompts、服务 instructions、手册资源、连接 Skill 和客户端配置示例。

功能依据为私有仓库 source/stable-near-far@b724289 的 src/index.js 与 tool-registry.js。工具名称和输入参数定义来自原始源码；使用中的辅助模块保留来源及 MIT 许可。当前传输、跨平台执行和远端任务为本分支适配实现，不冒称找回原始工程。

不复制旧 Cloudflare/OpenSSH 启动与导入链、局域网功能、旧交互式 CLI 菜单、没有被当前实现引用的旧模块，也不提交第三方运行包、node_modules、dist、凭据和日志。它们仍保存在历史源码材料中，未删除稳定版材料。

## 功能与边界

全部工具都有真实处理器，不用“已注册”代替执行验收。数据库需要对应客户端和数据库权限；定时备份需要现有调度设施；Unix owner/mode、Windows ACL、POSIX signal 不能混为一谈。原版有缺陷或平台不兼容的实现按实际功能适配，具体差异见 [操作手册](MCP-MANUAL.md)。

端口转发支持 local、remote 和 SOCKS5 CONNECT，但两端绑定/目的地仅回环，排除局域网。持久 shell 保持目录和环境，不提供 PTY。文件同步用 SFTP 实现 dryRun、exclude、delete 和 checksum，不依赖 rsync、不宣称已启用压缩。日志跟随以五秒窗口返回实际内容，不留下无法管理的后台进程。

## 37 个已实现工具

- [x] `ssh_list_servers`
- [x] `ssh_execute`
- [x] `ssh_upload`
- [x] `ssh_download`
- [x] `ssh_sync`
- [x] `ssh_session_start`
- [x] `ssh_session_send`
- [x] `ssh_session_list`
- [x] `ssh_session_close`
- [x] `ssh_health_check`
- [x] `ssh_service_status`
- [x] `ssh_process_manager`
- [x] `ssh_monitor`
- [x] `ssh_tail`
- [x] `ssh_alert_setup`
- [x] `ssh_backup_create`
- [x] `ssh_backup_list`
- [x] `ssh_backup_restore`
- [x] `ssh_backup_schedule`
- [x] `ssh_db_dump`
- [x] `ssh_db_import`
- [x] `ssh_db_list`
- [x] `ssh_db_query`
- [x] `ssh_deploy`
- [x] `ssh_execute_sudo`
- [x] `ssh_alias`
- [x] `ssh_command_alias`
- [x] `ssh_hooks`
- [x] `ssh_profile`
- [x] `ssh_connection_status`
- [x] `ssh_tunnel_create`
- [x] `ssh_tunnel_list`
- [x] `ssh_tunnel_close`
- [x] `ssh_key_manage`
- [x] `ssh_execute_group`
- [x] `ssh_group_manage`
- [x] `ssh_history`

## 验收

通过 SDK 客户端验证 tools/list、prompts/list/get、resources/list/read，再检查每个工具的实际输出、退出码和目标副作用。缺少数据库或调度设施时的真实失败不能算端到端业务成功。验收覆盖及限制见 [验证说明](MCP-VALIDATION.md)。保留公网连续十分钟稳定性要求；断线后已有操作不能透明续接。
