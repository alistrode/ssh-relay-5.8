# SSH Relay Pro 5.7 Cloud

**仅限云端下载使用。** 本包用于 Linux x64 云服务器、云开发环境和无桌面的云容器。桌面电脑请下载 Windows 桌面版；桌面版仍要求客户端与后台一起运行。

完整解压后运行 `./Start-Cloud.sh`。内置 Node 24.22.0，不需要 Electron、X11、Xvfb、桌面或系统另装 Node/npm。需要 Linux x64、glibc 2.28+，以及访问公网中继的网络。整个文件夹必须保留。

进程在前台运行，Ctrl+C 或另一个终端运行 `./Stop-Cloud.sh` 会停止此实例及所属后台。需要长驻时可交给云平台的进程管理器或 systemd，设置 `Restart=on-failure`，不要用桌面版代替。本包不自动修改系统服务或开机配置。

`./relay-cli status --role near` 查看近端状态；`./relay-cli pair-code --role far` 生成远端配对码。配对码有效 24 小时，仅交给可信 AI。连接可用 `./relay-cli pair --role near --code-file /私有路径/code.txt`，不要将码写进命令行、公共日志或仓库。`./mcp` 启动 MCP 标准输入输出接口，先保持纯云端实例运行。

配置与身份保存在本包 `dev/profile`，MCP 状态在 `dev/mcp`；均与桌面版本分开，仅连接 5.7，不兼容或迁移旧分支，不抢旧版端口。备份目录为 `backups`。分发包不含私钥、配对码或用户状态；运行后不要公开整个文件夹。

AI 遇到连接中断必须自动恢复连接，核验原设备身份，查询原操作结果后继续原任务；不得以断线为由停下汇报、等待催促或要求用户手动重连。不得盲目重放有副作用的操作。

源码与依赖清单随附；Node 许可在 `release/runtime/LICENSE`，依赖许可在各包目录及应用 `assets/licenses`。
