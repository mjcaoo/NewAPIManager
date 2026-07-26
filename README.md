# New API Manager

一个面向 Windows 的 New API 本地管理器。管理器不修改 New API 核心，而是把 `new-api.exe` 作为独立子进程启动，并集中管理生命周期、SQLite 数据、日志、备份和 GitHub Release 升级。

## 已实现功能

- Windows 通知区域常驻，关闭主窗口不退出服务
- 启动、停止、重启 New API 核心
- 导入已有 `new-api.exe`
- 从 `QuantumNous/new-api` GitHub Releases 检查并安装 Windows x64 核心
- 升级前自动停止核心并备份数据；新版本健康检查失败时尝试回滚
- 从备份目录恢复数据与配置；恢复前自动备份当前状态，失败时尝试回滚
- 数据、配置、日志、备份和下载文件全部存放在应用根目录
- 可修改端口、设置核心自动启动、管理器开机启动、预发布版本策略
- 捕获 stdout/stderr 并写入按日期划分的日志
- 单实例运行

## 目录布局

```text
NewApiManager/
├─ New API Manager.exe       # 打包后
├─ core/
│  ├─ current/new-api.exe    # 当前核心
│  └─ versions/              # 升级前的旧核心
├─ config/
│  ├─ manager.json           # 管理器配置，首次运行自动生成
│  └─ new-api.env            # 额外传给核心的环境变量
├─ data/new-api.db           # SQLite 数据库
├─ logs/core/                # 核心输出日志
├─ backups/                  # 停机一致性备份
└─ downloads/                # 升级下载与暂存
```

New API 官方支持通过 `PORT` 与 `SQLITE_PATH` 指定监听端口和 SQLite 文件。管理器会强制把 `SQLITE_PATH` 指向 `data/new-api.db`，因此核心升级不会覆盖数据。

## 开发运行

要求：Node.js 20+、npm。

```powershell
npm install
npm run check
npm test
npm start
```

首次启动后有两种安装核心的方式：

1. 在界面点击“导入 new-api.exe”；
2. 点击“检查更新”，再点击“下载并升级”。

也可手动复制：

```powershell
.\scripts\import-core.ps1 -Source "D:\Downloads\new-api.exe"
```

## 打包 Windows 程序

```powershell
npm install
npm run dist:win
```

输出位于 `dist/`：

- NSIS 当前用户安装包；
- 单文件 Portable 版本。

安装包配置为 `perMachine: false`。建议安装到默认的 `%LOCALAPPDATA%\Programs\New API Manager`，不要安装到普通用户不可写的 `C:\Program Files`。便携版会使用其自身所在目录；代码通过 `PORTABLE_EXECUTABLE_DIR` 避免把数据写到临时解压目录。

安装新版本覆盖升级时，安装器会保留现有的 `config/`、`core/`、`data/`、`logs/`、`backups/` 和 `downloads/`。普通卸载仍会删除安装目录中的这些运行数据，请在卸载前按需备份。

## 发布 GitHub Release

先更新 `package.json` 与 `package-lock.json` 中的版本并提交，再推送匹配的 `vX.Y.Z` 标签：

```powershell
git tag v0.1.3
git push origin v0.1.3
```

`.github/workflows/release.yml` 会在 Windows runner 上执行 `npm ci`、语法检查、测试和 `npm run dist:win`，然后发布安装包、Portable 版本、blockmap 与 `SHA256SUMS.txt`。标签版本与 `package.json` 不一致时发布会失败；包含连字符的标签会标记为预发布版本。

## 配置 New API 环境变量

编辑 `config/new-api.env`，每行一个 `KEY=VALUE`。例如：

```dotenv
MEMORY_CACHE_ENABLED=true
TZ=Asia/Shanghai
STREAMING_TIMEOUT=300
SESSION_SECRET=replace-with-a-long-random-string
CRYPTO_SECRET=replace-with-a-long-random-string
```

`PORT` 与 `SQLITE_PATH` 由管理器覆盖，不应写入该文件。
默认不设置 `TZ`，核心会使用 Windows 本地时区；如需固定时区，可在该文件中显式设置。

## 当前限制

- Windows 对隐藏控制台进程缺少通用的“优雅 SIGTERM”机制；当前停止操作会终止子进程，并在超时后清理进程树。SQLite 可进行事务恢复，但仍建议避免在高并发写入时频繁手动停止。
- 自动升级依赖 GitHub Releases 的资产命名；选择器优先匹配 Windows x64 的 `.exe`，其次为 `.zip`。若上游未来改变资产结构，需要调整 `src/services/update-utils.js`。
- 当前只面向 Windows x64。ARM64 需要增加架构识别和资产选择规则。
- 管理器自身尚未实现自动更新，只更新 New API 核心。

## 许可证与上游义务

管理器源码采用 MIT License。New API 核心采用其上游许可证。分发包含 New API 二进制的安装包前，请阅读并履行上游 GNU AGPLv3、署名、原项目链接和其他附加条款。参见 `THIRD_PARTY_NOTICE.md`。
