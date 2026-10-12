# AIAssets 部署文档

## 概述

AIAssets 采用「中心 Hub + 多客户端」架构。

- Hub：服务端上运行，负责存储、Web UI、鉴权、分享、全文搜索
- 轻客户端：其他电脑上运行，负责读取本机 Agent 会话推送到 Hub / 拉取 Hub 会话注入本机 Agent
- 客户端两种形态：Electron 桌面应用（推荐）和 CLI 命令行（轻量脚本）

---

## 一、Hub 部署（服务端）

### 1.1 前置要求

- Node.js 24+（需要内置 node:sqlite 和 zlib.zstdDecompressSync）
- 无其他任何依赖（零 npm 包、零 Python）

### 1.2 部署步骤

1. 拷贝整个 AIAssets 项目目录到服务端（不含 node_modules、dist、hub-data）
2. 启动：node src/server/index.js（监听 http://0.0.0.0:4891）
3. 本机浏览器打开 http://localhost:4891，设置页初始化管理员账号
4. 开机自启（可选）：

```bash
# pm2 方式
npm install -g pm2
pm2 start src/server/index.js --name aiassets
pm2 save && pm2 startup
```

### 1.3 公网暴露（三选一）

```bash
# 方式 A：Cloudflare Tunnel（推荐，自动 HTTPS，无需公网 IP）
cloudflared tunnel --url http://localhost:4891

# 方式 B：有公网 IP，路由器端口转发 4891 到本机

# 方式 C：Caddy 反代
#   caddy reverse-proxy --from your.domain.com --to localhost:4891
```

### 1.4 安全设置

1. 启用鉴权：设置页 -> 开启访问控制 -> 设置管理员用户名和密码
2. 生成 Token：设置页 -> Token 管理 -> 新建 Token（给轻客户端用）
3. 建议 HTTPS（Cloudflare Tunnel 或 Caddy 自动处理）

---

## 二、轻客户端部署（Mac / 笔记本 / 其他电脑）

### 方式 A：Electron 桌面应用（推荐）

#### 构建

在开发机（或服务端）上执行一次：

```bash
cd desktop-app
pnpm install
pnpm run build:win     # Windows 安装包
pnpm run build:mac     # macOS 安装包
```

产物在 desktop-app/dist/ 下：

- AIAssets Setup 1.0.0.exe（Windows NSIS 安装包，约 78 MB）
- AIAssets-1.0.0.dmg（macOS DMG）

#### 使用

1. 将安装包拷贝到目标电脑，双击安装
2. 启动后自动打开首次配对窗口：
   - 填入 Hub 地址（如 https://your-hub.example.com）
   - 填入在 Hub 设置页生成的 Token
   - 勾选「自动同步（每 60 秒）」
3. 点击保存并连接，自动跳转 Web UI
4. 之后系统托盘常驻，可随时右键立即同步或打开 AIAssets

#### 功能

| 功能 | 说明 |
| :--- | :--- |
| 首次配对 | 填 Hub 地址 + Token，验证连通性 |
| 自动同步 | 每 60 秒轮询，推本地新会话 + 拉云端新会话 |
| 托盘常驻 | 关闭窗口不退出，右键托盘菜单操作 |
| 手动同步 | 托盘右键 -> 立即同步 |

### 方式 B：CLI 命令行

#### 前置要求

- Node.js 24+
- 本机已安装至少一个 Agent（Codex / WorkBuddy / Pi / Gemini / DSH 任一）

#### 步骤

1. 拷贝项目目录到本机
2. 在中心 Hub 的设置页 Token 管理 -> 新建 Token
3. 配置并同步：

```bash
# 配置（一次性）
node src/client/index.js config --hub http://hub:4891 --token <你的Token>

# 双向同步（推送本地新会话 + 拉取云端新会话）
node src/client/index.js sync

# 开机自动同步（可选，守护模式）
node src/client/index.js daemon
```

#### 命令一览

| 命令 | 说明 |
| :--- | :--- |
| config --hub url --token t | 配置中心 Hub 地址与 Token |
| sync | 双向同步（推 + 拉） |
| push | 仅推送本地新会话到 Hub |
| pull | 仅拉取 Hub 新会话注入本机 Agent |
| status | 查看配置与上次同步状态 |
| daemon | 守护模式（每 60 秒自动双向同步） |

---

## 三、多设备同步流程

### 首次接入新设备

1. 在新设备上安装 Agent（如 Codex）
2. 安装轻客户端（桌面应用或 CLI）
3. 配置 Hub 地址 + Token
4. 执行 sync（或等待自动同步触发）
5. 本机 Agent 目录会自动出现云端会话，重启 Agent 即可看到

### 日常使用

- 新设备上产生新会话 -> 自动推送回 Hub
- 其他设备执行 sync（或等自动同步）-> 拉取到本地

### 会话冲突

- Hub 以「最后写入时间」为准，同一会话 ID 后写入覆盖先写入
- 极端情况（两台设备同时修改同一会话）以 Hub 上的版本为准
- 本地删除的会话会备份到 deleted-backups 目录，可手动恢复

---

## 四、目录结构

```
AIAssets/
  src/
    server/index.js       # Hub 服务端（单文件，零依赖）
    client/index.js       # CLI 轻客户端
    adapters/
      codex/              # Codex
      workbuddy/          # WorkBuddy
      pi/                 # Pi
      gemini/             # Gemini
      dsh/                # DSH (DeepSeek)
      claude/             # Claude Code（预留，未接入 Hub）
    core/                 # 公共工具
    cli/                  # 旧版 CLI
  desktop-app/
    main.js               # Electron 主进程
    setup.html            # 首次配对页
    package.json          # electron-builder 配置
  frontend/               # React 前端源码
  docs/wiki/              # 设计文档（14 篇）
  hub-data/               # Hub 运行时数据
  cloud-hub-storage/      # 云端会话文件存储
  package.json            # 项目根（无 npm 依赖）
```

---

## 五、FAQ

### Q: 两台设备都需要部署 Hub 吗？
A: 不需要。只有服务端需要跑 Hub。其他设备只跑轻客户端，连到 Hub 即可。

### Q: 轻客户端需要安装 Node 环境吗？
A: Electron 桌面应用不需要，安装包已内置 Electron 运行时。CLI 方式需要 Node.js 24+。

### Q: 多台设备的项目目录不同怎么办？
A: AIAssets 会话采用「逻辑项目」分组（按原始 cwd 识别），不同设备目录名不影响会话匹配。迁移到其他 Agent 时可自由选择目标分组。

### Q: 如何保证会话安全？
A: 所有远程 API 请求都要求 Bearer Token 或登录 Cookie；公网建议配 HTTPS。

### Q: 自动上云是什么？
A: Hub 服务端的定时任务，轮询本机 Agent 目录，把新会话自动备份到云端存储。默认关闭，在设置页开启。

### Q: Claude Code 什么时候支持？
A: 适配器（src/adapters/claude/）已就绪，Hub 接入即将完成。
