<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/logo-dark.png">
  <img src="docs/img/logo-light.png" alt="AIAssets" width="480">
</picture>

**AI 资产管理中心** —— 让 AI 对话成为可随身迁移的数字资产。

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-24%2B-green.svg)](https://nodejs.org)
[![Release](https://img.shields.io/github/v/release/NanYuJun/AIAssets?include_prereleases)](https://github.com/NanYuJun/AIAssets/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](./docs/DEPLOYMENT.md)

</div>

---

把散落在各个 AI 编程助手里的会话，汇聚成一个可同步、可迁移、可分享、可备份的**个人资产库**。

## ✨ 特性

- 🔀 **跨 Agent 迁移** — Codex ↔ WorkBuddy ↔ Claude Code ↔ Gemini CLI ↔ DSH (DeepSeek) ↔ Pi，任意方向互导，且保留 AI 生成的会话标题
- ☁️ **跨设备同步** — 服务端做 Hub，笔记本/台式机轻客户端自动双向同步（频率可调）
- 🔗 **分享** — 为朋友生成带访问码 + 查看次数上限的分享链接，一键导入到他的 Hub
- 🗂 **会话集** — 按项目组织会话，一键打包导出 ZIP
- 🛡 **容灾备份** — 本地镜像 + Cloudflare R2 / 阿里云 OSS / 腾讯 COS 定时打包备份，多目标异地容灾
- 👥 **多用户** — 账号密码登录、成员权限、游客模式（仅迁移）、登录防爆破
- 🔍 **全文搜索** — 毫秒级检索全部会话内容
- 🗑 **回收站** — 删除的会话保留 30 天，可恢复防误删
- 🌓 **白天/黑夜模式** — 两套品牌 Logo 自动适配
- 🖥 **桌面客户端** — Electron，托盘常驻、自动同步、无边框窗口、自动更新
- 🔄 **自动更新** — 客户端从 GitHub Releases 或 Hub 自动检查下载新版本

## 🤖 支持的 Agent

| Agent | 读取 | 写入 | 本地存储 |
| :--- | :---: | :---: | :--- |
| Codex | ✅ | ✅ | `~/.codex/sessions/` |
| WorkBuddy | ✅ | ✅ | `~/.workbuddy/` + SQLite |
| Claude Code | ✅ | ✅ | `~/.claude/projects/` |
| Gemini CLI (Antigravity) | ✅ | ✅ | `~/.gemini/antigravity/` |
| DSH (DeepSeek) | ✅ | ✅ | `~/.dsh/sessions/`（zstd） |
| Pi | ✅ | ✅ | `~/.pi/agent/sessions/` |

## 🏗 架构

```
MacBook（Agent + 轻客户端）──┐
                            ├──→ 服务端（Hub：云端存储 + Web UI + 鉴权 + 分享）
台式机（Agent + 轻客户端）──┘
```

- **Hub**（服务端）：Web UI、云端会话存储、鉴权、分享、全文搜索、容灾备份
- **轻客户端**：Electron 桌面应用（推荐）或 CLI，双向同步本机 Agent 会话
- **服务端零 npm 依赖**：仅使用 Node.js 内置模块，部署 = 一个 node 命令

## 🚀 快速开始

### 环境要求

- Node.js **24+**（使用内置 `node:sqlite` / `zlib.zstdDecompressSync`）
- pnpm（构建前端/桌面端用）

### 1. 启动 Hub（服务端）

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

安装后填入服务端地址 + 账号密码即可自动同步。只需要迁移功能可以「跳过登录」，无需账号。

### 或者只用 CLI

```bash
node src/client/index.js config --hub http://hub:4891 --user admin
node src/client/index.js sync      # 双向同步
node src/client/index.js daemon    # 后台守护，按配置频率自动同步
```

## 📦 功能总览

### 会话管理

- 统一会话仓库：本地 + 云端合并展示、分组/平铺视图、按 Agent 筛选
- 会话详情预览（Markdown 渲染）、导出 Markdown / ZIP
- 跨 Agent 迁移时**保留 AI 生成标题**（读取各 Agent 本地数据库）
- 回收站（30 天保留，防误删）、远程访问日志

### 分享与协作

- 分享链接：访问码 + 查看次数上限 + 到期撤销 + 一键导入
- 会话集：按主题分组打包、批量分享/导出

### 自动化

- 自动上云：可配监听哪些 Agent、同步频率（10 分钟 ~ 6 小时）
- 容灾备份：本地镜像 + 多云端目标、频率可调、保留份数滚动清理
- 桌面客户端托盘常驻，关闭窗口后台继续同步

### 安全

- 多用户：admin / member 角色，数据按用户隔离
- 鉴权：账号密码登录 + 设备 Token（可单独吊销），游客模式仅开放迁移
- 登录防爆破：5 次失败锁定 5 分钟
- 服务端零依赖：无第三方 npm 包供应链风险

## 📖 文档

| 文档 | 说明 |
| :--- | :--- |
| [部署文档](./docs/DEPLOYMENT.md) | 服务端 / 轻客户端 / 多设备同步 / FAQ |
| [发布流程](./docs/RELEASE.md) | 版本发布与自动更新分发 |
| [设计 Wiki](./docs/wiki/) | 架构、各 Agent 存储逆向、数据规范等 15 篇 |
| [备份配置示例](./docs/backup-config.sample.json) | 容灾备份配置参考 |

## 🛡 安全说明

- 所有运行时数据（账号、Token、会话）都在 `hub-data/` 与 `cloud-hub-storage/`，已被 `.gitignore` 排除，**不会进入仓库**
- 公网部署请务必配 HTTPS（[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) / Caddy）
- 登录接口内置防爆破（5 次失败锁 5 分钟）
- 分享链接支持访问码 + 次数上限，防止链接外泄滥用

## 🗺 Roadmap

- [ ] Skills 资源管理
- [ ] MCP 工具配置管理
- [ ] 会话云端分页加载（服务端已支持）
- [ ] macOS / Linux 客户端打包
- [ ] 会话导入去重策略增强

## 🤝 参与贡献

欢迎 Issue 和 PR！提交前请阅读 [NOTICE](./NOTICE) 与 Apache 2.0 协议要求。

## 📜 署名要求

基于本项目或其部分代码构建的产品，请保留 [NOTICE](./NOTICE) 文件或在产品文档中注明来源（Apache 2.0 协议要求）。

## 📄 License

[Apache-2.0](./LICENSE) © [NanYuJun](https://github.com/NanYuJun)