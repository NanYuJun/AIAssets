# AIAssets 知识库与设计文档 (Wiki)

欢迎查阅 **AIAssets**（AI 资产管理中心 —— 多 Agent 会话聚合、同步与迁移）的设计与技术规范。

> 面向贡献者与想深入了解实现细节的用户。日常安装使用请看 [主 README](../../README.md) 与 [部署文档](../DEPLOYMENT.md)。

## 📖 按主题阅读

### 🎯 产品与架构

| # | 文档 | 内容 |
| :-- | :--- | :--- |
| 01 | [产品需求规格说明书 (PRD)](./01-PRODUCT-REQUIREMENTS.md) | 项目愿景、核心用户场景、功能需求矩阵与非功能性要求 |
| 02 | [系统架构设计说明书](./02-SYSTEM-ARCHITECTURE.md) | 端云分离架构、分层模块职责（Web / Core / Adapters / Cloud） |
| 03 | [标准数据结构规范](./03-CANONICAL-SCHEMA.md) | CanonicalSession / CanonicalMessage / CanonicalToolCall 统一抽象模型 |
| 09 | [云端集中维护与 Web 控制台架构](./09-CLOUD-WEB-DASHBOARD-ARCHITECTURE.md) | 云端资产中心、勾选式上传与网页端拉取注入 |

### 🔌 Agent 存储逆向与适配器

| # | 文档 | 内容 |
| :-- | :--- | :--- |
| 05 | [WorkBuddy 存储逆向](./05-WORKBUDDY-STORAGE-REVERSE.md) | SQLite 表结构、Projects 目录 Slug 算法、JSONL 消息格式 |
| 06 | [Codex 存储逆向](./06-CODEX-STORAGE-REVERSE.md) | Rollout JSONL 结构、系统提示词深度降噪规则、生成标题读取 |
| 10 | [Pi 适配器规范](./10-PI-ADAPTER.md) | version 3 JSONL 结构、Reader 解析与 Writer 注入 |
| 14 | [多 Agent 适配与设置中心](./14-MULTI-AGENT-SETTINGS.md) | Gemini / DSH / Claude 适配与设置页实现 |

### 🔄 同步、迁移与分享

| # | 文档 | 内容 |
| :-- | :--- | :--- |
| 04 | [跨设备路径重映射规范](./04-PATH-REMAPPING-SPEC.md) | Windows ↔ macOS 绝对路径/相对路径转换方案 |
| 08 | [跨设备路径映射配置](./08-PHASE-2-PATH-MAPPING-CONFIG.md) | 设备配置文件、多设备别名与路径 Rebase 引擎 |
| 11 | [会话分享设计（参考 Immich）](./11-SHARING-AND-SYNC-DESIGN.md) | 分享令牌、导入语义、安全边界与 Immich 逻辑映射决策记录 |
| 12 | [鉴权、分享、导入与会话集](./12-AUTH-SHARING-IMPLEMENTATION.md) | 访问控制规则、分享 API、导入接收端与会话集管理 |

### 🚀 实现记录与演进

| # | 文档 | 内容 |
| :-- | :--- | :--- |
| 07 | [Phase 1 实现总结与 CLI 手册](./07-PHASE-1-IMPLEMENTATION.md) | 核心模块说明、自动化测试与命令行指南 |
| 13 | [性能优化与自动同步规范](./13-PERF-AUTOSYNC.md) | 云端内存索引、自动上云轮询、全文搜索 |
| 15 | [多用户、桌面客户端与安全强化](./15-MULTIUSER-DESKTOP-SECURITY.md) | 多用户能力矩阵、双 Token 生命周期、登录防爆破、Electron 内嵌前端、会话标题来源、分享安全增强 |

## 🧭 新贡献者阅读路径

1. 先读 [01 PRD](./01-PRODUCT-REQUIREMENTS.md) 了解产品定位
2. 再读 [02 架构](./02-SYSTEM-ARCHITECTURE.md) 与 [03 数据规范](./03-CANONICAL-SCHEMA.md) 建立全局认知
3. 根据你要改的模块选读对应的存储逆向 / 适配器文档
4. 改动涉及鉴权 / 分享 / 多用户时，**必须**读 [15 安全强化](./15-MULTIUSER-DESKTOP-SECURITY.md)

## 📌 约定

- 所有 Agent 会话先解析为 **Canonical Schema**（见 03），再做迁移/分享/备份
- 新增 Agent 支持 = 新增 `src/adapters/<agent>/`（reader + writer）+ 在服务端注册读写
- 运行时数据（账号、Token、会话）永不入库（见根目录 `.gitignore`）
