---
name: workspace-backup-dev
description: 项目分支索引维护规范。
---

# 项目分支索引维护

如果你看到这段话，你必须立刻去看仓库主分支的workspace-backup-dev这个skill，禁止查看主分支的其他skill

如果是云端环境，无需启动图形界面。

禁止通过中继、隧道或连接传输任何稍大的文件或数据；需要这些内容时，应由需要文件或数据的一端自行下载。

每次变动分支时立刻更新主分支workspace-backup-dev所有项目分支索引地图，

当前开发分支：5.7。运行源码基线 bdd0dd1；Windows 实机连接、任务取消与后续执行、原生窗口绘制、文件往返和 300 次连续状态查询已记录。完整性能计划仍有待办，见 docs/PERFORMANCE-5.7.md。源码、Windows 与 Linux Cloud 运行包统一保存在 packages/5.7，Git LFS 保存归档。

## 本版本有用命令与维护脚本索引

- [构建与启动规则](../../../AGENTS.md)：构建 npm run build；不创建或运行项目测试套件。
- [Windows/Linux 打包](../../../scripts/package-unified.py)：固定 Electron 运行时、生产依赖及资源，生成 PACKAGE.json。
- [Linux Cloud 打包](../../../scripts/package-cloud57.cjs)：独立云端发行版，内置 Node 与许可证。
- [源码归档](../../../scripts/package-source57.py)：只归档提交中的源码与依赖清单，排除历史包、运行记录和私密状态。
- [包内依赖检查](../../../scripts/verify-package-dependencies.cjs)：检查实际生产入口均在包内解析。
- [Windows 维护脚本说明](../../../scripts/maintenance57/README.md)：指定 5.7 实机备份、部署、受控重启、日志检查、状态采集、原生窗口采集与清理。脚本中的路径对应本次指定机器，禁止套用到未知目标。
- [实机与包源码比较](../../../scripts/maintenance57/verify-installed57.ps1)：比较包清单中的全部核心运行文件，结果保存在 packages/5.7/INSTALLED-SOURCE-COMPARISON.json。
- [界面请求失败边界](../../../scripts/maintenance57/ui57-errors.js)、[短时状态观察](../../../scripts/maintenance57/soak57.js)、[连续观察启动](../../../scripts/maintenance57/start-soak57.js)、[连续观察结果](../../../scripts/maintenance57/soak-status57.js)、[长堆栈与原因链手工诊断](../../../scripts/maintenance57/logprobe57.js)、[恢复临时界面显示](../../../scripts/maintenance57/restore57-ui.js)：通过已核验 5.7 客户端的本地调试接口执行；属于手工实机诊断，不自动运行。

只保存经过脱敏的命令、脚本与结果。配对码、身份密钥、私人 profile、原始日志和桌面截图不上传。
