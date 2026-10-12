
# 07. Phase 1 实现总结与 CLI 使用手册

## 1. Phase 1 交付成果

本阶段已完成 **Codex ➡️ WorkBuddy** 的完整本地解析、提示词清洗与结构注入闭环：

1. **核心降噪器 (`Cleaner`)**：
   - 彻底正则过滤掉 Codex 会话注入的系统指令标签（包括 `<INSTRUCTIONS>`、`<environment_context>`、`<skills_instructions>`、`<permissions instructions>`、`# AGENTS.md instructions` 等）；
   - 保留纯正的用户提问、AI 答复和思考推理过程。
2. **跨机器路径映射器 (`PathRemapper`)**：
   - 具备将绝对路径转换为规范占位路径 `${PROJECT_ROOT}/...` 的能力；
   - 支持多平台路径动态重绑定（Rebase）。
3. **WorkBuddy 目录算法 (`computeWorkBuddySlug`)**：
   - 实现了与 WorkBuddy 原生 100% 一致的项目 Slug 转换规则（例如 `E:\work\1Ton` 转换为 `e-example-1Ton`）。
4. **Codex 提取器 (`CodexReader`)**：
   - 流式解析本地 `~/.codex/sessions/**/*.jsonl`，按时间倒序排列并提取为 `CanonicalSession`。
5. **WorkBuddy 写入与注入器 (`WorkBuddyWriter`)**：
   - 生成标准的 WorkBuddy 流式 JSONL 会话文件；
   - 支持跨平台原子更新 `workbuddy.db` 的 `sessions` 索引表，确保客户端可见。
6. **自动化测试套件 (`test/run-tests.js`)**：
   - 包含提示词降噪、路径映射、Slug计算、真实会话提取与模拟写入的 5 项单元/集成测试，全部通过。

---

## 2. 命令行 (CLI) 快速使用指南

确保当前处于 Node.js 20+ 环境：
```bash
# 切换到项目根目录
cd agent-sync-hub

# 1. 扫描并列出本机所有的 Codex 历史会话
node src/cli/index.js list

# 2. 将指定会话导出为纯净的标准中间格式 (Canonical JSON)
node src/cli/index.js export <sessionId> [outputPath]

# 3. 将会话（默认最新）直接注入到 WorkBuddy 的指定项目工程
node src/cli/index.js to-workbuddy <targetProjectPath> [sessionId]
# 示例:
node src/cli/index.js to-workbuddy E:/work/example-warehouse
```

---

## 3. 下一步演进路线 (Phase 2 & Phase 3)

- **Phase 2 (路径持久化配置)**：在本地生成 `sync-config.json`，记录设备别名与工作区目录对照表；
- **Phase 3 (云端与加密)**：集成 WebDAV / S3 云存储，引入 AES-256-GCM 本地端到端加解密；
- **Phase 4 (可视化控制台)**：搭建 React + Vite 前端，提供双端会话查看与一键同步界面。

