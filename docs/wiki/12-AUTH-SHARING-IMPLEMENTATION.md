# 12. 鉴权、分享、导入与会话集实现规范

本文档记录已实现的四项功能：访问控制、分享令牌、朋友导入、会话集管理。

## 1. 访问控制（Auth）

### 规则

- **本机请求直通**：来自 `127.0.0.1` / `::1` 的请求无需凭据；
- **远程请求必须鉴权**：`Authorization: Bearer <token>` 或 URL 参数 `?token=`，浏览器场景使用 HttpOnly Cookie（`hub_token`，30 天）；
- 首次访问 `/` 未登录时跳转登录页；首次部署时登录页显示「初始化账号」表单（仅本机可执行 setup）；
- 密码使用 scrypt（N=16384）加盐哈希存储；Token 为 64 位 hex 随机串，可撤销；
- 未初始化账号时系统完全开放（本机单用户场景），初始化后立即进入受控模式。

### API

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/api/auth/status` | 鉴权状态（配置、本机、Token 列表） |
| POST | `/api/auth/setup` | 初始化账号（仅首次，成功后自动登录） |
| POST | `/api/auth/login` | 登录，颁发 Token 并设置 Cookie |
| POST | `/api/auth/logout` | 撤销当前 Token 并清除 Cookie |

数据文件：`hub-data/auth-credentials.json`（账号）、`hub-data/auth-tokens.json`（Token）。

## 2. 分享令牌（Shares）

### 行为

1. 在会话资产库勾选会话 → 点「分享」→ 配置有效期（24h / 7d / 30d）、访问码（可选）、是否允许导入；
2. 生成短 ID 分享链接 `/s/<shareId>`（8 位随机字母数字，无易混淆字符）；
3. 分享落地页展示只读会话列表 + 「导入到我的 Hub」表单；
4. 支持随时撤销，撤销立即生效（410）。

### API

| 方法 | 路径 | 鉴权 | 说明 |
| :--- | :--- | :--- | :--- |
| POST | `/api/shares` | 需要 | 创建分享 |
| GET | `/api/shares` | 需要 | 列出全部分享 |
| GET | `/s/:shareId` | 访问码 | 分享落地页 |
| GET | `/api/shares/:id` | 访问码 | 分享元信息 |
| GET | `/api/shares/:id/sessions` | 访问码 | 会话摘要列表 |
| POST | `/api/shares/:id/import` | 访问码 | 拉取会话推送到接收方 Hub |
| POST | `/api/shares/:id/revoke` | 需要 | 撤销分享 |

状态码：`404` 不存在、`410` 已撤销或过期、`401` 访问码错误。

### 导入流程

接收方在分享页填写自己的 Hub 地址与 Token，服务端逐个读取分享会话的 Canonical JSON，追加 `metadata.shareOrigin`（shareId、时间、原始 Agent），通过 `POST /api/sessions/import-incoming` 推送到目标 Hub。导入是**复制语义**：接收方拿到副本，双方后续修改互不影响。

## 3. 导入接收端（Import Incoming）

`POST /api/sessions/import-incoming`：

- 需要目标 Hub 的 Bearer Token（已配置账号时）；
- 校验 session.id 合法性（basename 安全检查）；
- 自动补全 project.name（按接收方本机项目数据源解析）；
- 直接写入云端 JSON 存储，导入的会话与本地会话按 ID 合并展示。

## 4. 会话集（Collections）

会话集是对一组会话的命名打包（类似 Immich 相册）：

- 创建：在资产库勾选会话 → 「会话集」→ 输入名称 → 创建；
- 操作：分享（一键为整集生成分享链接）、删除；
- 会话集分享复用 Shares 机制，`createdByDevice` 记录 `collection:<名称>`。

### API

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | `/api/collections` | 创建会话集 |
| GET | `/api/collections` | 列出全部 |
| GET | `/api/collections/:id` | 详情 |
| PUT | `/api/collections/:id` | 更新名称/描述/成员 |
| DELETE | `/api/collections/:id` | 删除 |
| POST | `/api/collections/:id/share` | 为整集生成分享 |

数据文件：`hub-data/collections/<id>.json`。

## 5. 验证记录

- 端到端 API 测试（隔离目录）：账号初始化 → 重复初始化拒绝 → 错误密码 401 → 创建带访问码分享 → 错误码 401 → 正确码列出会话 → 撤销后 410 → 无码分享导入成功（imported=1）→ 会话集创建 → 整集分享成功；
- Playwright UI 测试：分享弹窗生成链接（含访问码）→ 会话集创建可见 → 分享落地页显示「可导入」与导入表单，无控制台错误；
- 核心回归：7/7 通过。

## 6. 已知边界

- 部署到公网时必须配置 HTTPS 反向代理（本服务自身是 HTTP）；
- 分享中的会话正文存储在云端 JSON，访问码只是入口门槛，正文本身未做 E2EE（后续版本计划）；
- Token 无过期时间（长期有效），可通过 logout 撤销。
