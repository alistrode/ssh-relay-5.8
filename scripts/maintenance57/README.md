这些脚本记录本次指定 Windows 实机 5.7 维护，路径对应 E:\xxm\ssh-relay-5.7-isolated 和独立 Acer profile。执行前必须使用已核验目标；不是通用系统修复工具。备份在 E:\xxm\beifen\ssh-relay-5.7。restart57 只在客户端归属匹配且确认后台已停止后结束该 GUI，再启动既有 5.7 交互任务。勿将正在运行的远端命令重复提交。capture57 只使用原生 PrintWindow，不采集整个桌面；截图必须私下检查并删除。

界面 .js 脚本是手工实机诊断表达式，应通过已核验 5.7 客户端本地 CDP 执行，不是浏览器网页或项目测试套件。ui57-errors 会故意提交一条无效角色请求以检查失败边界；logprobe57 会故意记录带原因链及长堆栈的诊断。start-soak57 每秒读取一次状态，300 次后自行结束；soak-status57 返回摘要。restore57-ui 仅恢复诊断期间临时隐藏的配对码区域。不要在不知情的用户机器上执行诊断。

传输入口保留本次使用的固定身份检查逻辑，并把临时工作区路径改为显式环境参数：RELAY_SOURCE 是含 src/ 与 node_modules/ 的 5.7 应用根目录，RELAY_AGENT 是已保存授权的近端目录，RELAY_DEVICE 是已核验设备 UUID。mcp57.mjs 从 stdin 读取原 MCP 工具 JSON；remote-powershell57.cjs 接收本地 PowerShell 文件；cdp57.cjs 接收表达式文件，默认仅转发远端回环 45957；sftp57.cjs 的参数为 put 本地文件 远端文件 或 get 远端文件 本地文件。它们只用于明确授权的维护，不自动配对或改动主机指纹；优先使用 MCP 原业务入口。
