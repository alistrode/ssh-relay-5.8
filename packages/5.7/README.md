# SSH Relay Pro 5.7

- Windows x64: 完整解压 SSHRelayPro-5.7-win32-x64.zip，打开文件夹运行 Start.cmd。已包含 Electron 44.8.0、生产依赖、资源与当前修复；无需安装 Node/npm。首次使用独立的 5.7 配置。
- Linux x64 Cloud: 仅限云端下载使用。完整解压 SSHRelayPro-5.7-Cloud-Linux-x64.tar.gz，运行 ./Start-Cloud.sh；内置 Node 24.19.0。./Stop-Cloud.sh 停止。无需图形界面。
- SSHRelayPro-5.7-source.zip: 完整应用源码、依赖清单、构建/维护脚本，排除历史 run-records、其他运行包和私密状态。

版本源码提交见 WINDOWS-PACKAGE.json 和 CLOUD-BUILD.json。Windows 核心运行文件已逐项与指定实机比较；测量和边界见 docs/PERFORMANCE-5.7.md、docs/5.7-RUNTIME-OBSERVATIONS.json。启动仍有延迟，未声称全部性能计划完成。

Git LFS 保存三个归档。Git 克隆后执行 git lfs pull，或使用 GitHub 文件页的下载入口获取完整文件，勿把 LFS 指针当作运行包。包内不包含用户授权、配对码或私人日志。
