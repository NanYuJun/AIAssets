
# Agent Sync Hub 知识库与设计文档 (Wiki)

欢迎查阅 **Agent Sync Hub**（多智能体跨设备会话聚合与同步中心）的设计与技术规范。

## 📑 Wiki 目录导航

1. [01. 产品需求规格说明书 (PRD)](./01-PRODUCT-REQUIREMENTS.md)
   - 项目愿景、三大核心用户场景、功能需求矩阵与非功能性要求。
2. [02. 系统架构设计说明书](./02-SYSTEM-ARCHITECTURE.md)
   - 端云分离架构、分层模块职责（Web / Core / Adapters / Cloud）。
3. [03. 标准数据结构规范 (Canonical Schema)](./03-CANONICAL-SCHEMA.md)
   - 核心抽象模型定义（CanonicalSession、CanonicalMessage、CanonicalToolCall）。
4. [04. 跨设备路径与跨系统环境重映射规范](./04-PATH-REMAPPING-SPEC.md)
   - 跨机器/跨操作系统（Windows ↔ macOS）绝对路径与相对路径转换方案。
5. [05. WorkBuddy 本地底层存储逆向解析](./05-WORKBUDDY-STORAGE-REVERSE.md)
   - SQLite `workbuddy.db` 表结构、Projects 目录 Slug 算法、JSONL 消息格式。
6. [06. Codex 本地底层存储逆向解析](./06-CODEX-STORAGE-REVERSE.md)
   - Codex 会话目录组织、Rollout JSONL 解析、系统提示词深度降噪规则。
7. [07. Phase 1 实现总结与 CLI 使用手册](./07-PHASE-1-IMPLEMENTATION.md)
   - 当前核心代码模块说明、自动化测试报告与命令行使用指南。
8. [08. Phase 2 跨设备路径映射配置规范](./08-PHASE-2-PATH-MAPPING-CONFIG.md)
   - 设备配置文件 (`sync-config.json`)、多设备别名与项目动态路径 Rebase 引擎。
9. [09. 云端集中维护与 Web 控制台架构规范](./09-CLOUD-WEB-DASHBOARD-ARCHITECTURE.md)
   - 云端资产中心（Session Hub）、勾选式上传（Selective Push）与网页端随时拉取（Web Pull & Inject）。
10. [10. Pi 适配器实现规范](./10-PI-ADAPTER.md)
    - Pi 会话存储结构（version 3 JSONL）、Reader 解析规则与 Writer 注入规范。
11. [11. 会话分享与朋友间同步设计（参考 Immich）](./11-SHARING-AND-SYNC-DESIGN.md)
    - 分享令牌、导入语义、安全边界与 Immich 逻辑映射决策记录。
12. [12. 鉴权、分享、导入与会话集实现规范](./12-AUTH-SHARING-IMPLEMENTATION.md)
    - 已实现的访问控制规则、分享令牌 API、导入接收端与会话集管理。
13. [13. 性能优化与自动同步规范](./13-PERF-AUTOSYNC.md)
    - 云端内存索引、自动上云轮询、全文搜索、回收站与 ZIP 导出。
14. [14. 多 Agent 适配与设置中心](./14-MULTI-AGENT-SETTINGS.md)
15. [15. 多用户、桌面客户端与安全强化规范](./15-MULTIUSER-DESKTOP-SECURITY.md)
    - 多用户能力矩阵、双 Token 生命周期、登录防爆破、页面结构、Electron 内嵌前端、会话标题来源、分享安全增强、回收站策略。
    - Gemini / DSH 适配器、设置页（鉴权/Token/存储统计/日志）、回收站 UI 与 Markdown 导出。
