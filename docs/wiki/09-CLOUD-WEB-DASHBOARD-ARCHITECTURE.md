
# 09. 云端集中维护与 Web 控制台架构规范

## 1. 业务与交互模型

用户明确的核心诉求：
1. **云端维护所有会话资产**：云端作为统一的会话资产中心（Session Hub），持久化存储各个设备上传的对话记录；
2. **本地选择性同步 (Selective Push)**：在本地管理界面上，用户可以查看本机发现的所有会话，支持【全选】或【自由勾选】特定会话推送到云端；
3. **网页端随时拉取 (Web Pull & Inject)**：在任意设备上打开浏览器网页，可以看到云端的所有会话列表；点击指定会话，选择当前设备的目标工程路径，一键拉取并热注入到本地的 WorkBuddy / Codex 中。

---

## 2. 系统拓扑：端云一体架构

```text
┌─────────────────────────────────────────────────────────────┐
│                    Cloud Session Hub (云端中心)              │
│   - 会话对象存储 (S3 / R2 / 坚果云 WebDAV / 自建服务)         │
│   - 元数据索引：会话标题、生成设备、项目名称、消息数、时间戳       │
└──────────────────────────────▲──────────────────────────────┘
                               │ HTTPS API (Push / Pull)
┌──────────────────────────────▼──────────────────────────────┐
│              Local Sync Daemon & Web Server (本地服务)       │
│   - 端口: 127.0.0.1:4891 (打开浏览器即见控制台)              │
│   - 核心 API:                                               │
│     * GET  /api/sessions/local : 探测本机 Codex/WorkBuddy/Pi   │
│     * POST /api/sessions/push  : 批量勾选上传至云端          │
│     * GET  /api/sessions/cloud : 浏览云端资产库              │
│     * POST /api/sessions/pull  : 本地优先解析并注入目标 Agent   │
│   - 本地写入器: WorkBuddyWriter / PiWriter / PathRemapper     │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 网页端控制台交互设计 (Web Dashboard UI)

网页分为三大核心工作区：
1. **【本地会话列表】**：
   - 实时扫描本地所有 Codex、WorkBuddy 与 Pi 对话；
   - 提供复选框多选、全选、会话详情预览面板；
   - 底部操作栏：【批量上传到云端】。
2. **【云端资产中心】**：
   - 展示已经保存在云端的全部历史会话；
   - 显示会话来源设备、所属项目、轮数与时间；
   - 操作按钮：【拉取到当前设备】。
3. **【注入对话弹窗】**：
   - 选择目标 Agent（如 WorkBuddy）；
   - 输入或选择目标工作区路径；
   - 自动执行路径 Rebase，完成一键注入。

---

## 4. 真实工程名称智能对齐与拉取分组选择

### 4.1 官方工程名称 1:1 对齐
- 项目分组不再使用静态映射字典，而是**实时读取各 Agent 自己的数据源**：
  - Codex：`~/.codex/state_5.sqlite`（projects + project_roots 表）；
  - WorkBuddy：`~/.workbuddy/workbuddy.db`（workspaces 表）；
  - Pi：`~/.pi/agent/sessions` 目录名解码。
- WorkBuddy / Pi 的项目路径与 Codex 项目路径一致时，沿用 Codex 侧边栏中的官方显示名；
- 无法匹配时使用工作区目录名；所有未归档的会话归入「最近对话 (未归档项目)」。

### 4.2 目标助手拉取项目分组弹窗 (Target Project Selector)
- 点击【同步拉取到本机 WorkBuddy】时，系统不再弹出简陋的 prompt 输入框，而是弹出专用的【选择目标助手项目分组】弹窗；
- 用户可以在下拉列表中选择希望该会话归入的目标项目（例如把某个讨论归入库房或云平台），并支持自定义新路径；
- 系统自动完成全部文件路径与终端命令的 Rebase 重写，保证多端多项目井井有条，互不干扰。

---

## 5. 统一会话资产库（当前已实现的形态）

本地会话库与云端资产中心已合并为单一「会话资产库」，按会话 ID 去重合并：

- 每条会话显示状态标记：`仅本地` / `已上云` / `仅云端`；
- 同一 ID 在多个 Agent 有本地副本时去重为一行，并叠加显示 Agent 徽标（Codex / WorkBuddy / Pi）；
- 底部统一操作：全选/反选、批量上传到云端、批量同步到本地 Agent；
- 「批量同步到本地 Agent」不要求先上云：本地 Codex 会话可直接迁移为 WorkBuddy，反之亦然，云端仅用于跨设备传递；
- 选择统计实时显示：已选择 N 项 · 可上传 X · 可同步 Y。

## 6. 当前 API 清单（实际实现）

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/api/projects?agent=` | 实时读取目标 Agent 项目列表（codex / workbuddy / pi） |
| GET | `/api/sessions/local` | 本地多 Agent 会话摘要（含缓存预热与来源错误上报） |
| POST | `/api/sessions/push` | 勾选会话写入云端 JSON 存储 |
| GET | `/api/sessions/cloud` | 云端会话列表 |
| GET | `/api/sessions/detail/:id` | 详情预览（云端 → Codex → WorkBuddy → Pi 顺序解析） |
| POST | `/api/sessions/pull` | 本地优先解析会话并注入目标 Agent（codex / workbuddy / pi），路径自动 Rebase |

实现说明：
- `/api/sessions/pull` 的来源优先级：本地其他 Agent → 本地同 Agent → 云端；注入结果标注 `sourceLocation` 与 `sourceAgent`；
- WorkBuddy 写入强制完成 `sessions` 表登记，失败即整体失败（不静默）；SQLite 读写均强制 UTF-8，规避中文标题在 Windows 下的编码错误；
- 会话文件匹配支持三种文件名形式：`<id>.jsonl`、`<前缀>-<id>.jsonl`（Codex rollout）、`<前缀>_<id>.jsonl`（Pi）。
