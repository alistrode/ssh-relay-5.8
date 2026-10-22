---
name: ssh-relay
description: 使用 SSH Relay MCP/CLI 连接和操作远端 Windows/Linux。用户提供配对码、指定已记住的设备或要求远程操作时使用。
---

# SSH Relay 操作入口

收到用户远程操作要求后，主动使用已配置的 SSH Relay MCP 完成操作。

1. 先调用 `ssh_list_servers` 查看设备，不猜测目标主机。
2. 首次配对调用 `ssh_connect`，传入用户提供的配对码；后续使用已记住的设备。一端最多同时连接五台。
3. 使用原 MCP 工具执行用户要求，通过原 `server` 参数指定目标；参数以工具 schema 为准。
4. 持久操作返回 `operationId` 时，使用 `ssh_operation_status` 查询结果，不因等待超时重复提交。连接仍在进行时，使用连接状态工具查询，不重复配对。
5. MCP 工具不可见时，连接和状态查询使用包内 CLI 的同等入口；先查看 `--help`，支持的参数从 stdin 传入。完整包入口为 Windows `CLI.cmd`、Linux `CLI.sh`，源码入口见 `package.json` 的 `relay-cli`。CLI 没有对应业务命令时，接入包内 MCP 后使用原工具，不虚构 CLI 命令。

设备记忆、认证、连接、控制权及内部恢复由软件负责。不要自行编排连接修复、修改端口或要求用户翻查内部日志。远端明确要求开机、授权或升级时，向用户说明必要的最小动作。
