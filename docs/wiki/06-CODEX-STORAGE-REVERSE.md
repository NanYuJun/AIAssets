
# 06. Codex 本地底层存储逆向解析

## 1. 存储全景图

Codex 本地会话保存在 `~/.codex/sessions` 下，采用按年月日归档的目录树结构：
`~/.codex/sessions/YYYY/MM/DD/rollout-<uuid>.jsonl`

---

## 2. 数据结构特性

每行是一个顶层事件：
- `session_meta`：记录会话启动时间戳、工作目录 `cwd`、Git 分支等；
- `response_item`：内嵌 `payload`，包含用户提问与模型答复；
- `custom_tool_call` / `custom_tool_call_output`：工具执行与输出。

---

## 3. 系统提示词深度降噪清洗规则

Codex 会话在用户第一轮发言前注入了大量的系统级提示词，直接同步会导致大量噪点。清洗模块必须正则过滤掉以下 XML 标签与标记：
- `<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>`
- `<environment_context>[\s\S]*?<\/environment_context>`
- `<skills_instructions>[\s\S]*?<\/skills_instructions>`
- `<permissions instructions>[\s\S]*?<\/permissions instructions>`
- `<collaboration_mode>[\s\S]*?<\/collaboration_mode>`
- `<app-context>[\s\S]*?<\/app-context>`
- `<recommended_plugins>[\s\S]*?<\/recommended_plugins>`
- `<apps_instructions>[\s\S]*?<\/apps_instructions>`
- `# AGENTS\.md instructions[\s\S]*?(?=(?:\r?\n){2,}|$)`

