# 14. 多 Agent 适配与设置中心

## 1. 当前支持的 Agent 矩阵

| Agent | 读取 | 写入 | 本地存储位置 | 格式 |
| :--- | :--- | :--- | :--- | :--- |
| Codex | ✅ | ✅ | `~/.codex/sessions/**/*.jsonl` | Rollout JSONL |
| WorkBuddy | ✅ | ✅ | `~/.workbuddy/projects/<slug>/<id>.jsonl` + SQLite | JSONL + SQLite 索引 |
| Pi | ✅ | ✅ | `~/.pi/agent/sessions/--<path>--/<ts>_<id>.jsonl` | version 3 JSONL |
| Gemini | ✅ | ✅ | `~/.gemini/antigravity/brain/<uuid>/logs/transcript.jsonl` | Antigravity transcript JSONL |
| DSH (DeepSeek) | ✅ | ✅ | `~/.dsh/sessions/--<path>--/session-<uuid>/session.v4.jsonl.zstd` | zstd 压缩 JSONL（Node 24 内置解压） |

**zstd 无需外部依赖**：Node 24+ 内置 `zlib.zstdDecompressSync` / `zstdCompressSync`。

五个 Agent 之间任意方向读取 + 写入全部打通（同上表）。

## 2. 设置页功能清单

### 自动上云
- 开关 + 立即执行按钮
- 每 60 秒轮询本地 Agent 目录（可配置），新/变更会话自动备份到云端
- 过滤系统注入/空会话
- 状态显示：监听范围、上次运行时间、累计备份数

### 云端存储统计
- 会话总数 / 总占用 / 分享导入数 / 分享占用

### 鉴权与 Token 管理
- 启用鉴权（用户名+密码，本机表单直接设置）
- 修改密码（强制吊销所有 Token）
- Token 列表：新建（带备注，自动复制）、吊销
- Token 90 天自动过期
- 忘记密码：本机一键重置鉴权

### 回收站
- 列出已删除本地会话的备份（Agent、文件名、删除时间、大小）
- 彻底删除单个备份

### 远程访问日志
- 记录每个远程 API 请求（时间/方法/路径/是否授权）
- 保留最近 200 条

## 3. 全文搜索

资产库搜索框输入 ≥2 字符自动触发云端正文全文搜索（防抖 600ms）。结果展示标题 + 命中片段预览 + Agent/项目/时间，最多 30 条。

`GET /api/sessions/search?q=`

## 4. Markdown 导出

- 单会话：资产库行内「导出」按钮 → 下载 `.md`
- 会话集：会话集列表「导出 zip」→ 打包全部成员为 ZIP（无依赖内置 ZIP 打包器）

`GET /api/sessions/export-md/:id` · `GET /api/collections/:id/export-zip`

## 5. Loading 体验

- 全局遮罩：所有写操作（同步/分享/删除/导出）执行中显示中央 loading
- 按钮内嵌旋转图标并禁用防重复
- 多选删除弹窗：勾选目标后确认删除触发 loading，完成后关闭弹窗

## 6. 已知限制

- Gemini / DSH 写入格式为事件级转录，不等于原生客户端完整会话结构（可能丢失部分元数据）
- DSH zstd 压缩依赖 Node ≥ 24（更低版本无内置 zstd）
- 回收站暂无批量恢复（仅单个彻底删除）
