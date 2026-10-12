
# 05. WorkBuddy 本地底层存储逆向解析

## 1. 存储全景图

WorkBuddy 本地运行核心数据保存在 `~/.workbuddy` 目录下：

```text
~/.workbuddy/
├── workbuddy.db             # SQLite 数据库，记录所有工作区与会话元数据
├── projects/                # 各项目按 Slug 分组的会话文件目录
│   └── <project_slug>/
│       ├── <session_id>.jsonl          # 实际流式消息记录
│       └── <session_id>.file-rollback.ndjson
└── workspace/sessions/      # 临时或快照缓存
```

---

## 2. Project Slug 命名算法

经逆向分析与样本验证，WorkBuddy 将本地工作区路径转换为目录名 Slug 的规则如下：
1. 盘符转小写并去除冒号（如 `E:` ➡️ `e`）；
2. 将所有连续的斜杠与反斜杠（`/` 或 `\\`）替换为连字符 `-`；
3. 去除首尾的多余连字符。

**对照验证表：**
| 实际本地路径 | 转换后 Slug 目录名 |
| :--- | :--- |
| `E:\work\1Ton` | `e-example-1Ton` |
| `E:\work\yikeda-admin` | `e-example-yikeda-admin` |
| `C:\Users\yourname\WorkBuddy\2026-08-04-18-06-21` | `c-Users-70000-WorkBuddy-2026-08-04-18-06-21` |

---

## 3. SQLite 元数据表 (sessions)

写入新会话必须在 `workbuddy.db` 的 `sessions` 表中插入一行记录：

```sql
INSERT INTO sessions (
  id, cwd, user_id, title, status, created_at, updated_at, 
  last_activity_at, deleted_at, is_playground, mode, transport, unread
) VALUES (
  ?, ?, ?, ?, 'completed', ?, ?, ?, NULL, '0', 'craft', 'local', '0'
);
```

---

## 4. 消息文件规范 (JSONL)

每行代表一个事件对象，主要事件类型包括：
- `{"type":"message", "role":"user", "content":[{"type":"input_text","text":"..."}]}`
- `{"type":"reasoning", "rawContent":[{"type":"reasoning_text","text":"..."}]}`
- `{"type":"message", "role":"assistant", "content":[{"type":"output_text","text":"..."}]}`

