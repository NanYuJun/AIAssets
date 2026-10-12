# 10. Pi 适配器实现规范（Reader / Writer）

## 1. 存储位置与目录命名

Pi 的会话保存在 `~/.pi/agent/sessions` 下，按工作区路径分目录：

```text
~/.pi/agent/sessions/
├── --E--example-1Ton--/
│   └── 2026-08-28T09-06-53-379Z_<session-id>.jsonl
├── --C--Users-70000--/
└── --E--example-example-shop-vue3--/
```

目录名规则：绝对路径中的 `:`、`\\`、`/` 统一替换为 `--`，首尾加 `--`。目录名中的连字符存在歧义（路径里的 `-` 无法区分），因此读取器优先使用文件内 `session.cwd` 元数据，目录名解码只作为回退。

## 2. 会话文件格式（version 3）

每行一个 JSON 事件，顶层事件类型：

| 类型 | 说明 |
| :--- | :--- |
| `session` | 会话元数据：`id`、`version: 3`、`timestamp`（ISO 8601）、`cwd` |
| `model_change` | 记录 provider 与 modelId，首个消息事件的父节点 |
| `thinking_level_change` | 思考强度变更 |
| `message` | 消息事件，`message.role` 为 `user` / `assistant` / `toolResult` |

`message.content` 为数组，部件类型：
- `text`：纯文本；
- `toolCall`：助手侧工具调用，含 `id`、`name`（小写，如 `bash`/`read`）、`arguments` 对象；
- `toolResult` 消息通过 `toolCallId` + `toolName` 关联调用，`isError` 标记失败。

事件链通过顶层 `parentId` 字段串联，与 WorkBuddy 的线性 parent 链类似。

## 3. Reader 映射规则

- `user` 文本消息 → `kind: 'message', role: 'user'`，首条用户文本经 Cleaner 清洗后作为会话标题；
- `assistant` 的 `toolCall` 部件 → `kind: 'tool_call'`，工具名按 `read→Read`、`bash→Bash`、`edit→Edit`、`write→Write` 规范化；
- `toolResult` → `kind: 'tool_result'`，通过 `toolCallId` 关联；
- 图片等非文本部件当前跳过，仅保留文本。

## 4. Writer 注入规则

`PiWriter.injectSession(canonical, targetProjectRoot)` 流程：

1. `PathRemapper.rebaseSession` 将全部路径重写到目标工作区；
2. 生成 `session` 行（`version: 3`，`cwd` 为目标路径）与 `model_change` 行；
3. 按 Canonical 事件顺序生成 `message` 行：
   - 工具调用写为 assistant 的 `toolCall` 部件，`stopReason: 'toolUse'`；
   - 工具结果写为 `toolResult` 角色；
   - `arguments` 中含 `command` 的统一映射为 `{ command }`；
4. 文件写入 `sessions/--<目标路径>--/<时间戳>_<sessionId>.jsonl`，目录名中盘符冒号会被去除（`E:` → `E`）。

## 5. 已知限制

- 未写入 Pi 的任何索引数据库（当前未发现 Pi 存在会话索引库）；新文件是否立即被 Pi 识别需在 Pi 客户端中实际验证；
- 图片、二进制附件不做迁移；
- `thinking_level_change` 不迁移。
