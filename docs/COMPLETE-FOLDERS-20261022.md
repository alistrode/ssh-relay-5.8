# 完整近端/远端文件夹交付记录（2026-10-22）

交付位置：[GitHub Release](https://github.com/trlstdin/rororororo/releases/tag/ssh-relay-complete-20261022)。四个完整运行包和完整源码包均已上传；最终运行包已从 Release 下载后直接复核。

## 包内容和使用

提供 Windows x64 近端、Windows x64 远端、Linux x64 近端、Linux x64 远端四个独立文件夹。压缩包内各有一个顶层目录，完整解压后保留整个目录。

- Windows：双击 `Start.cmd`。Linux：终端运行 `./Start.sh`。入口启动该包对应角色后台并打开现有双角色管理界面。
- 近端首次启动生成 `MCP-CONFIG.json`，其绝对路径指向包内 Node 和 MCP；将配置加入所用 AI 客户端。远端生成 24 小时内可重复使用的配对码。首次授权属于正常配对步骤。
- `Open-UI` 重新打开现有统一图形管理界面；`CLI`、`MCP`、`Status`、`Stop` 提供相应入口。统一界面支持管理两种角色；近端/远端包的默认后台角色由各自 `PACKAGE.json` 固定。
- 本机运行状态、授权和私钥首次运行时生成于用户目录 `.ssh-relay-pro`，不使用测试机器的授权。迁移目录前先停止后台，之后重新生成 AI 的 MCP 路径配置。

内置：Noto Sans CJK SC 中文字体及 SIL OFL 1.1 许可证、完整应用业务源码、生产 `node_modules`、锁文件、默认公共中继配置、profiles、配置模板、Node 24.22.0、Electron 44.8.0 和原有桌面界面、Windows WinSW 2.12.0、PostgreSQL/MySQL/MongoDB 客户端、对应库和许可证。未手工删减 npm 生产依赖。包内 `vendor/PROVENANCE.json`、`PACKAGE.json`、`FILES-SHA256.json` 记录来源、版本和逐文件校验。

数据库服务器和用户数据库、AI 模型/客户端及账号不属于工具运行时，未预置。私钥、配对码、数据库密码和测试原始日志没有上传。不会复制临时机器的私人状态。

目标系统是 Windows 10 1903+ x64、Ubuntu 24.04 x64 桌面；不是所有 Linux 发行版通用。图形界面需要系统桌面库。Linux 系统禁止普通用户命名空间时，启动入口需要一次 sudo 授权：校验官方 Electron helper 后，仅把本文件夹的 `chrome-sandbox` 准备为 root/4755。不关闭 Chromium 沙箱、不修改全局内核或 AppArmor 设置。允许用户命名空间时使用相应沙箱。CLI/MCP 不需要图形桌面。

## 来源和构建

业务源码保持 `912d073ce859184aa6006c3d8829aaa71df87430`，`src/`、桌面业务 JavaScript、profiles 和依赖锁文件保持不变。桌面 CSS 补充内置中文字体并让控件继承字体。旧临时机器已释放，目录依照该源码、锁文件和固定 Node 版本还原，不能称为原机器逐字复制。新增文件只负责打包入口和操作/分发。

Linux 原生包构建：[39761456013](https://github.com/trlstdin/rororororo/actions/runs/39761456013)，对应封装源码 `b0b1c75`；Windows 含 app-local VC++ DLL 的原生包构建：[39762679916](https://github.com/trlstdin/rororororo/actions/runs/39762679916)，对应 `1736e13`。字体补入这批原生包后重新生成所有逐文件校验与归档；保留原生构建提交并记录 GUI 资产提交。Windows/Linux 在各自原生系统安装锁定生产依赖后打包；用户下载无需 npm install。`SSHRelay-complete-source.zip` 是与该交付对应的完整项目源码，应用源码和锁文件同时保留在每个运行文件夹 `resources/app`。

## 已完成的候选包直接操作

此前候选包经仓库上传/下载后，在新的 Ubuntu 24.04 和 Windows Server 2022 VM 上逐文件校验并直接运行包内 Node；不在验证机重新构建产品或安装 npm 依赖。

- Linux 近端连接 Linux/Windows 远端；确认真实设备/账号、协议 2、包内 Node 路径和实际输出。
- 两端包内 PostgreSQL/MySQL/MongoDB 客户端的真实路径和版本核对；上传 131096 字节文件，SHA-256 与原文件一致。
- Windows 近端通过包内 MCP 发现 39 个工具和 5 个提示；实际配对 Linux、执行命令和跨系统上传，文件校验一致。工具发现不等于全部参数组合通过。
- Windows 近端和远端 GUI 均实际渲染，返回标题和后台在线状态。
- Linux 首个候选包缺少沙箱首次权限准备，GUI 被系统拒绝；此失败未算通过。补充入口在独立调试副本中实测后，GUI 渲染并显示后台在线，helper 权限为 root/4755；随后重新打包。调试副本不作为最终下载包验收。
- 同一近端并发首次配对两个远端时，一个调用返回 Pairing already in progress；改为按顺序首次配对成功。没有更改业务源码绕过此限制。

Windows 原生数据库客户端的 PE 导入依赖含 VCRUNTIME140/MSVCP140；它们不是所有 Win10 系统默认都有的文件，因此将 Microsoft Visual C++ 14.44.35112 的可再分发 DLL 放入客户端目录，许可证与哈希随包保留。

Linux 实际截图发现未安装中文字体时文字显示方块；故补入固定来源和哈希的 Noto Sans CJK SC 字体。这属于分发的界面依赖补齐。

## 最终仓库下载包验证

最终发布任务：[39764454391](https://github.com/trlstdin/rororororo/actions/runs/39764454391)，GUI 资产及完整源码提交 `a0f93bd5bc4d0c5e0ea0626cd8dc52a60ae5b719`。新的原生验证 VM 任务：[39765179377](https://github.com/trlstdin/rororororo/actions/runs/39765179377)。两端从 Release 下载最终归档并核对 SHA-256、逐文件清单后直接启动包内运行时，未重新安装 npm 依赖或构建应用。

直接操作窗口为 2026-10-22 10:45:35.443 至 10:55:41.069 UTC，共 605.626 秒。期间没有产品补丁或手动修复后台；这是有人工发起操作的十分钟调试复核，不等于无人干预一小时或全功能全参数验收。未运行测试套件。

- Linux 近端通过实际 MCP 连接 Linux 和 Windows 远端，核对设备账号和远端 Node 位于下载文件夹。
- 四个包的桌面入口实际打开；Linux 近/远端、Windows 近/远端均显示后台在线。下载并查看最终两平台截图，中文文字可读。Windows 首次八秒观察仍在读取状态，后续观察在线，未据此修改产品。
- 向两平台上传并下载 131096 字节文件，往返 SHA-256 均为 `38db3d5f7dbbc38978c62e46dc97181dad74c4ce555d1739e1e6cd2c29aea9b8`。中文路径与中文内容文件 58 字节，往返 SHA-256 均为 `bacc1f1124fe8c771fe02a25d3582e53c58751b2dc4161afdf261e45da27d687`。
- 两平台分别创建会话，设置目录和环境变量，后续独立调用确认保留，再成功关闭会话。
- Windows 实际执行包内 PostgreSQL 14.24、MySQL 8.0.46、mongodump 100.17.0、mongosh 2.13.0，核对路径及 app-local VC++ DLL；包内 Node 为 24.22.0。
- 最终 MCP 发现 39 个工具、5 个提示。先前源码直接操作曾覆盖所有 39 个工具名称，见 [直接操作记录](DIRECT-MCP-DEBUG-20261022.md)；这不代表最终包全部功能或参数组合重新验收。已有关闭会话列表可能重新显示 unknown 的观察仍未宣称解决。
- Windows 近端后台使用其下载包内 Node 启动并由 GUI 确认在线。通过远端启动长期后台的调用返回 OPERATION_PENDING，随后核实实际进程和状态，没有重复启动来掩盖结果。

十分钟窗口后，主动释放 Linux 远端的原控制连接，Windows 近端通过其包内 MCP 成功配对该 Linux 远端，10:57:55 UTC 返回 ready。随后用户会话暂停期间 VM 达到两小时上限，于 12:44:49 UTC 前结束，两个托管任务正常完成。恢复后最后一轮 Windows 近端命令与上传未完成，不列为最终包通过项；候选包的相同操作也不替代该项。不存在仍需付费保留的临时 VM。

最终归档 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| SSHRelay-near-windows-x64.zip | `5ccad3d40794e032bdbc981836f79ff13b028318998cf1a172c74b56d456087b` |
| SSHRelay-far-windows-x64.zip | `b94f64b8198966d3a1b96c8ef47715f022223f4c74df5b3351876e7b7eb3b267` |
| SSHRelay-near-linux-x64.tar.gz | `3787c3b0a0dca22d6d91b70fc48875c2d64e76cc249de576ec8c8f13cf88d5cf` |
| SSHRelay-far-linux-x64.tar.gz | `7a6ced814ddb57a761e5742ae14e5c3b9caaab0783a308bf902ba59900abc46d` |
| SSHRelay-complete-source.zip | `89813add6518c65f6a77f6d6effb7dc436e765733fa3d5d416e22dbdbd3e50d2` |


Windows 实测系统是 **Server 2022**，不能替代 Windows 10 本机验收。即使完整依赖齐全，也不会据此声称已在 Windows 10 验证通过。先前源码的 39 工具调用和有限一小时结果不能代替最终包的运行结果；具体历史范围见其他报告。
