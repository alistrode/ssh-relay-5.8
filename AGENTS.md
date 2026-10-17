# SSH Relay Pro 2.0 工作规范

main 维护 SSH Relay Pro 2.0，versions/1.0～versions/4.0 是版本分类分支。旧 main 保存在 archive/main-before-pro-20261017；历史 recovery 分支继续保留。

- 连接 Windows/Linux 远端时读取 .agents/skills/ssh-relay-pro/SKILL.md；仅使用 Pro 的设备记忆、配对和恢复流程，不使用已删除的旧连接 skills 或旧导入器。
- 整理项目、修改项目代码或配置、打包或交付版本时读取 .agents/skills/workspace-backup-dev/SKILL.md；按已有 xxm 优先的规则确定目录，修改前备份、修改后做相关验证。
- Pro 源码位于 src/、desktop/，构建和来源说明见 docs/PRO-BUILD.md、docs/MCP-SOURCE-PROVENANCE.json。不要把打包产物冒称原始工程，或把第三方代码冒称自有实现。
- 保留现有公共中继，不要求用户自建服务器；不擅自连接电脑、修改环境、自启动或系统权限。复用授权、严格核验身份，恢复连接不重放业务写入。
- 私钥、配对码、连接报告、运行状态、原始日志、node_modules 和散装 dist 不提交 Git。deliverables/ 可保存授权交付的脱敏运行包、源码 ZIP 和校验文件。
- 依据 docs/PRO-VALIDATION.json 如实报告验收范围。应用运行源码变化后，一小时连续验收需对应最终源码，不能拼接中断记录或用历史通过代替当前验收。文档/skill 更新不冒称新增平台验收。

- 每个项目版本必须按 workspace-backup-dev 上传完整源码和对应的单文件夹运行包到仓库，并从仓库下载最终包在匹配平台的干净云端实际运行验证；未通过不得宣称可用。特大冗余文件可排除，必要外部依赖必须列出来源、固定版本、下载地址、校验与准备步骤，禁止用另行部署成功代替下载包验收。
