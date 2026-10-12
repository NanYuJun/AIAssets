# AIAssets

> **AI 资产管理中心** —— 让 AI 对话成为可随身迁移的数字资产。

把散落在各个 AI 编程助手里的会话，汇聚成一个可同步、可迁移、可分享、可备份的**个人资产库**。

- 🔀 **跨 Agent 迁移**：Codex ↔ WorkBuddy ↔ Claude Code ↔ Gemini CLI ↔ DSH (DeepSeek) ↔ Pi，任意方向互导
- ☁️ **跨设备同步**：常开电脑做 Hub，笔记本/台式机轻客户端自动双向同步
- 🔗 **分享**：为朋友生成带访问码的分享链接，一键导入到他的 Hub
- 🗂 **会话集**：按项目组织会话，打包导出
- 🛡 **容灾备份**：本地镜像 + Cloudflare R2 / 阿里云 OSS / 腾讯 COS 定时打包备份
- 👥 **多用户**：账号密码登录、成员权限、游客模式（仅迁移）
- 🌓 **白天/黑夜模式**
- 🖥 **桌面客户端**：Electron，托盘常驻、自动同步、无边框窗口

## 支持的 Agent

| Agent | 读取 | 写入 | 本地存储 |
| :--- | :--- | :--- | :--- |
| Codex | ✅ | ✅ | `~/.codex/sessions/` |
| WorkBuddy | ✅ | ✅ | `~/.workbuddy/` + SQLite |
| Claude Code | ✅ | ✅ | `~/.claude/projects/` |
| Gemini CLI (Antigravity) | ✅ | ✅ | `~/.gemini/antigravity/` |
| DSH (DeepSeek) | ✅ | ✅ | `~/.dsh/sessions/`（zstd） |
| Pi | ✅ | ✅ | `~/.pi/agent/sessions/` |

## 架构

```
MacBook（Agent + 轻客户端）──┐
                            ├──→ 常开电脑（Hub：云端存储 + Web UI + 鉴权 + 分享）
台式机（Agent + 轻客户端）──┘
```

- **Hub**（常开电脑）：Web UI、云端会话存储、鉴权、分享、全文搜索、备份
- **轻客户端**：Electron 桌面应用（推荐）或 CLI，双向同步本机 Agent 会话

## 快速开始

### 环境要求

- Node.js **24+**（使用内置 `node:sqlite` / `zlib.zstdDecompressSync`，服务端零 npm 依赖）
- pnpm（构建前端/桌面端用）

### 1. 启动 Hub（常开电脑）

```bash
git clone https://github.com/NanYuJun/AIAssets.git aiassets
cd aiassets
node src/server/index.js
# → http://0.0.0.0:4891
```

浏览器打开 `http://localhost:4891`，初始化管理员账号。

### 2. 构建前端（首次）

```bash
pnpm run build:web
```

### 3. 桌面客户端（其他电脑）

```bash
pnpm run build:desktop
# → desktop-app/dist/AIAssets Setup 1.0.0.exe
```

安装后填入 Hub 地址 + 账号密码即可自动同步。只要迁移功能可以「跳过登录」，无需账号。

### 也可以只用 CLI

```bash
node src/client/index.js config --hub http://hub:4891 --user admin
node src/client/index.js sync      # 双向同步
node src/client/index.js daemon    # 每 30 分钟自动同步
```

## 功能总览

- 统一会话仓库：本地 + 云端合并展示、分组/平铺、全文搜索
- 会话详情预览（Markdown 渲染）、导出 Markdown / ZIP
- 跨 Agent 迁移时**保留 AI 生成标题**（读取各 Agent 本地数据库）
- 会话集分组打包、一键分享/导出
- 分享：访问码 + 查看次数上限 + 到期撤销
- 回收站（30 天保留）、远程访问日志
- 自动上云（可配 Agent 范围与频率）、异地容灾备份（多目标）
- 鉴权：账号密码 + 设备 Token，登录防爆破

## 文档

- [部署文档](./docs/DEPLOYMENT.md)
- [设计 Wiki](./docs/wiki/)（架构、各 Agent 存储逆向、数据规范等 15 篇）
- [备份配置示例](./docs/backup-config.sample.json)
- [发布流程](./docs/RELEASE.md)

## 安全说明

- 所有运行时数据（账号、Token、会话）都在 `hub-data/` 与 `cloud-hub-storage/`，已被 `.gitignore` 排除，**不会进入仓库**
- 公网部署请务必配 HTTPS（Cloudflare Tunnel / Caddy）
- 登录接口内置防爆破（5 次失败锁 5 分钟）

## Roadmap

- [ ] Skills 资源管理
- [ ] MCP 工具配置管理
- [ ] 会话云端分页加载（服务端已支持）

## 署名要求

基于本项目或其部分代码构建的产品，请保留 [NOTICE](./NOTICE) 文件或在产品文档中注明来源（Apache 2.0 协议要求）。

## License

[Apache-2.0](./LICENSE)