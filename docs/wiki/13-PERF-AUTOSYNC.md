# 13. 性能优化与自动同步规范

## 1. 云端内存索引 (CloudIndex)

`src/core/cloud-index.js`：启动时全量扫描云端 JSON 一次建立内存索引，之后每次列表请求只增量刷新 mtime 变化的文件。上传/导入/删除实时更新索引。

实测：197 条会话列表接口从全量读盘（34MB IO）降至约 221ms。

`GET /api/cloud/stats` 返回 `{ count, totalBytes, sharedCount, sharedBytes }`。

## 2. 自动上云 (AutoSyncManager)

`src/core/auto-sync.js`：按配置间隔（默认 60 秒，最低 30 秒）轮询本地 Agent 会话目录，新会话或有更新的会话自动备份到云端。使用 mtime 去重，过滤系统注入/空会话。

`GET /api/auto-sync` 读取配置与状态；`POST /api/auto-sync` 修改配置（enabled / agents / intervalSec / runNow）。

## 3. 全文搜索

`GET /api/sessions/search?q=`：逐会话扫描正文，命中返回片段预览（前 80 字符 + 命中后 120 字符），最多 30 条。前端在搜索框输入 ≥2 字符后自动防抖搜索并展示结果。

## 4. 会话集 ZIP 导出

`GET /api/collections/:id/export-zip`：将会话集所有成员会话导出为 Markdown 打包成 ZIP 下载。使用无依赖的内置 ZIP 打包器（`src/utils/zip.js`，deflate 压缩 + UTF-8 文件名）。

## 5. 回收站

删除本地会话时自动备份到 `hub-data/deleted-backups/<agent>/`。

- `GET /api/recycle-bin`：列出所有备份
- `DELETE /api/recycle-bin/:agent/:file`：彻底删除

UI 在设置页。

## 6. Gemini 适配器

扫描 `~/.gemini/antigravity/brain/*/logs/transcript.jsonl`，解析 USER_REQUEST / PLANNER_RESPONSE / MODEL_RESPONSE / TOOL_CALL 事件。暂不支持写入 Gemini（只读）。

## 7. Claude / DSH 状态

- Claude：适配器已就绪，本机 `~/.claude/sessions` 为空目录，有数据即可工作。
- DSH：会话为 zstd 压缩 JSONL，需系统安装 zstd 后扩展解压解析；适配器检测框架已就绪。
