# 16. Agent 扩展：ZCode / OpenCode / Grok Build / Cursor

> 状态：已实现（2026-10）　前置阅读：[03 数据规范](./03-CANONICAL-SCHEMA.md)

## 1. 存储逆向结论

| Agent | 本地存储 | 格式 |
| :--- | :--- | :--- |
| ZCode（智谱 GLM Harness） | `~/.zcode/cli/db/db.sqlite` | SQLite：`session`（id/title/directory/time）+ `message`（id/session_id/data.role）+ `part`（message_id/data.type='text'/.text） |
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite：`session`（id/title/directory）+ `message`（data.role）+ `part`（data.type='text'） |
| Grok Build (xAI) | `~/.grok/sessions/<URL编码cwd>/<uuid>/chat_history.jsonl` | JSONL：`{ type: system\|user\|reasoning\|assistant, content: string \| [{type:'text',text}] }` |
| Cursor | `%APPDATA%/Cursor/User/globalStorage/state.vscdb` | SQLite：`cursorDiskKV` 表 → `composerData:<id>`（对话头 + fullConversationHeadersOnly）+ `bubbleId:<composerId>:<bubbleId>`（type 1=用户 2=AI，text） |

## 2. 各格式关键细节

### ZCode

- `message.data` 为 JSON 字符串：`{ role, time: { created } }`，正文在 `part` 表按 `message_id` 关联
- `part.type`：`text`（正文）、`step-start`（步骤标记）等，仅提取 text
- 注意 ZCode 应用运行时持有 SQLite 连接，Hub 只做只读查询（`readOnly: true`）

### OpenCode

- `message.data`：`{ role, time: { created } }`，正文在 `part` 表（`data.type = 'text'`）
- `part.type`：`text`、`step-start`、`tool` 等

### Grok Build

- 目录名是 **URL 编码的 cwd**（如 `C%3A%5CUsers%5C...`），解析时需 `decodeURIComponent`
- 首条 user 消息内嵌 `<user_info>` 元数据块，提取标题时需跳过
- `content` 可能是字符串或 `[{type:'text',text}]` 数组，两种都要处理

### Cursor

- 消息正文在 `cursorDiskKV` 表，key 格式为 **`bubbleId:<composerId>:<bubbleId>`**（复合键，不是单 bubbleId）
- `composerData:<id>` 的 `fullConversationHeadersOnly` 数组给出 bubble 顺序与 type（1=用户，2=AI）
- Cursor 运行时可能缓存，写入后建议重启 Cursor 再查看

## 3. 写入（注入）策略

| Agent | 写入方式 | 注意 |
| :--- | :--- | :--- |
| ZCode | INSERT session/message/part 同构记录 | id 需 `sess_` 前缀；part 逐条插入 |
| OpenCode | INSERT session/message/part | 需要有效 project_id（查不到则创建占位） |
| Grok Build | 写 chat_history.jsonl（同构行） | 目录名需 URL 编码；uuid 用 crypto.randomUUID |
| Cursor | INSERT composerData + bubbleId 行 | 建议注入后重启 Cursor；bubble key 为复合键 |

## 4. 服务端注册清单

新增 Agent 需在 `src/server/index.js` 完成以下注册（缺一不可）：

1. import Reader + Writer
2. 自动上云 `agents` 映射表
3. 自动上云 `agents` 白名单过滤
4. `resolveSessionForTransfer` 的 sources + files + canonical 三处
5. `rebuildLocalCache` 扫描块 + totalFound 累加
6. 删除接口 files 三元链
7. 拉取注入 writer 分支
8. import-incoming sourceAgent 白名单

## 5. Trae CN / Claude Desktop 为何暂不支持

- **Trae CN**：对话内容存储在字节云端，本地 IndexedDB/leveldb 仅为缓存，无可靠会话数据
- **Claude Desktop**：对话在 claude.ai 云端，本地 Electron 存储仅为 UI 状态
- 两者均无本地会话文件可解析，待官方提供本地导出功能后再评估

注：Claude **Code**（终端工具）已支持（见 [Claude 存储说明](./06-CODEX-STORAGE-REVERSE.md) 及 `~/.claude/projects/`）。
