# Pro 2.0.1 日志与启动修复候选

分支：`fix/ssh-pro-startup-20261019`。本目录仅保存完整源码候选与校验，不是可运行包，不代表 Windows 闪退已修好。

改动：GUI 载入前的结构化日志、后台离线日志摘要与 Chromium 固定错误码导出、输出管道保护、明确的启动失败退出，以及 Windows Start.cmd 默认经 UAC 请求管理员启动。Diagnostics.cmd 不需要提权。

`source.zip` 包含应用实现、资源、依赖清单/锁文件、构建资料和明确分开的测试工具；不含私密状态、运行日志、第三方依赖目录或运行时。生产依赖与运行时来源保持原锁文件及 assets/pro-runtime-inputs.json，构建步骤见 docs/PRO-BUILD.md。校验见 SHA256SUMS，源码提交和逐文件散列见 ZIP 内 SOURCE-MANIFEST.json。

本地 11 项检查及启动初始化失败留痕检查通过；Windows PowerShell 实机解析、当前候选 GUI、UAC 取消/确认与最终仓库下载包验证尚未完成，详情见 docs/PRO-STARTUP-VALIDATION.json。上级目录的 2.0.0 运行包是历史基线，不能与此候选源码混作完整新版本交付。
