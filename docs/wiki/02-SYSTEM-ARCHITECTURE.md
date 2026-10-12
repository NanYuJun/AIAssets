
# 02. 系统架构设计说明书

## 1. 总体设计原则

为支持未来“企业级登录权限、可视化管理看板、云端多设备协作”的大系统演进，系统采用**分层解耦、端云分离、内核轻量的模块化架构**：

```text
┌─────────────────────────────────────────────────────────────┐
│                    Web Dashboard (控制台)                   │
│   - 技术栈: React 19 + Vite + Tailwind CSS + shadcn/ui      │
│   - 功能: 可视化会话树、Diff 对比、设备列表、路径映射规则配置  │
└──────────────────────────────▲──────────────────────────────┘
                               │ HTTPS / REST / SSE
┌──────────────────────────────▼──────────────────────────────┐
│                    Sync Core Engine (同步核心)               │
│   - 路径重映射器 (Path Remapper)                            │
│   - 消息降噪过滤器 (Prompt / Noise Cleaner)                 │
│   - 因果链版本合并器 (Causal DAG Merger)                    │
│   - 端到端加解密模块 (AES-256-GCM / PBKDF2)                 │
└──────────────────────────────▲──────────────────────────────┘
                               │ 统一抽象接口
┌──────────────────────────────▼──────────────────────────────┐
│                 Agent Adapter Layer (适配器层)              │
│   ┌─────────────────────┐       ┌────────────────────────┐  │
│   │    Codex Adapter    │       │   WorkBuddy Adapter    │  │
│   │ - Rollout JSONL 读写│       │ - SQLite 事务写入/读取 │  │
│   │ - 系统指令过滤      │       │ - Projects JSONL 读写  │  │
│   └─────────────────────┘       └────────────────────────┘  │
│   ┌─────────────────────┐       ┌────────────────────────┐  │
│   │ Claude Code Adapter │       │ 其他编码助手 (可插拔)   │  │
│   └─────────────────────┘       └────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 核心模块职责划分

### 2.1 适配器层 (Agent Adapters)
- **职责**：屏蔽各家 AI 编码助手底层的私有存储格式（文件路径、JSON Schema、SQLite 表结构等）。
- **统一接口契约**：所有适配器必须实现 `AgentAdapter` 抽象接口：
  - `detect()`: 探测本机是否安装该 Agent 及其数据目录；
  - `listSessions()`: 列出所有会话摘要信息；
  - `readSession(id)`: 读取指定会话并归一化为 `CanonicalSession`；
  - `writeSession(session, targetProjectRoot)`: 将标准会话写入本地并更新索引。

### 2.2 标准化核心层 (Canonical Core)
- **职责**：系统的“数据普通话”。所有来自 Codex、WorkBuddy 的数据流先转换为标准结构 `CanonicalSession`，再转入目标端，避免 $N \times M$ 网状耦合。
- **Cleaner 子模块**：专门针对 Codex 和 WorkBuddy 的系统提示词注入、权限指令、环境标记进行深度清洗，提取出纯正的用户问答、思考过程与工具调用。

### 2.3 路径重映射层 (Path Remapper)
- **职责**：实现跨机器/跨操作系统（Windows ↔ macOS ↔ Linux）的无缝跳转。
- **核心逻辑**：
  - 存储态（Storage / Cloud）：所有文件路径转换为相对项目根路径（如 `src/App.vue`）；
  - 运行时（Runtime / Inject）：自动探测当前主机的实际绝对路径并动态拼接替换。

---

## 3. 端云协同与数据流设计

1. **导出与上传流**：
   `Codex 本地会话` ➡️ `CodexReader` ➡️ `Cleaner` ➡️ `CanonicalSession` ➡️ `Path Normalizer (相对路径化)` ➡️ `E2EE 本地加密` ➡️ `云存储 / WebDAV / S3`
2. **下载与注入流**：
   `云存储 / WebDAV / S3` ➡️ `E2EE 本地解密` ➡️ `Path Remapper (注入本地工作区绝对路径)` ➡️ `WorkBuddyWriter` ➡️ `本地 Projects JSONL + SQLite 数据库插入` ➡️ `WorkBuddy UI 可见`

