# 15. 多用户、桌面客户端与安全强化规范

> 状态：已实现（2026-10）　适用版本：v0.3+

## 1. 多用户模型

### 1.1 存储结构（hub-data/users.json）

```json
[
  {
    "id": "u_xxxx",
    "username": "admin",
    "displayName": "昵称",
    "avatarColor": "#3b82f6",
    "salt": "...",
    "passwordHash": "scrypt(...)",
    "role": "admin | member",
    "status": "active | disabled",
    "createdAt": 0,
    "lastLoginAt": 0
  }
]
```

- 旧版单用户 `auth-credentials.json` 首次访问自动迁移为 admin 账号
- 至少保留一个 admin；不能删除/禁用自己

### 1.2 能力矩阵

| 能力 | admin | member |
| :--- | :--- | :--- |
| 云端会话查看 | 全部 | 仅 ownerId 归属 |
| 分享/会话集 | 全部 | 仅自己的（服务端过滤 + 操作守卫 403） |
| 全文搜索 | 全部 | 仅自己的 |
| 回收站/日志 | ✓ | 空/隐藏 |
| 用户管理 | ✓ | 403 |

## 2. 双 Token 生命周期

| 类型 | 来源 | 有效期 | 清理时机 |
| :--- | :--- | :--- | :--- |
| session | 浏览器登录（写 Cookie） | 30 天（与 Cookie 一致） | 服务启动 + 每小时 `pruneExpiredTokens()` |
| device | 桌面客户端 / CLI（`deviceToken: true` 登录换发） | 90 天 | 同上 |

- 密码修改：吊销该用户全部 Token
- 用户删除/禁用：吊销其全部 Token
- 「我的设备」UI 仅显示 device 类型

## 3. 登录防爆破

- 键：`remoteAddress + username`
- 连续失败 5 次 → 锁定 5 分钟，返回 429
- 成功登录清零；Map 超 1000 条自动清理过期记录

## 4. 页面结构（React 前端）

| 路由 | 内容 | 可见性 |
| :--- | :--- | :--- |
| `#/sessions` | 会话资产库（右上角含回收站弹窗：分组/平铺、清空、彻底删除） | 所有登录用户 |
| `#/collections` | 会话集 | 所有登录用户 |
| `#/shares` | 分享管理 | 所有登录用户 |
| `#/account` | 我的账号（资料/改密/我的设备） | 所有登录用户（侧边栏底部用户信息点击进入） |
| `#/useradmin` | 用户管理（增删/禁用/重置密码） | 仅 admin（菜单隐藏 + 路由守卫） |
| `#/settings` | 自动上云/存储统计/日志 | 所有登录用户 |

## 5. Electron 桌面客户端（前端内嵌）

- React 构建两份产物：Hub Web 版（`public-react`，相对路径）+ 桌面版（`desktop-app/app-ui`，打进 asar）
- 桌面端加载本地 UI；API 走 `window.hubDesktop.getAuth()` 提供的 Hub 地址 + Bearer deviceToken
- preload 同步预载配置（`sendSync`），避免启动竞态
- 无边框窗口：右上角自绘 最小化/关闭（关闭=隐藏到托盘）；头部区域可拖拽
- 未登录显示 LoginView（Hub 地址 + 账号密码；Hub 未初始化时内嵌初始化表单）

## 6. 会话标题来源

| Agent | 来源 | 数据位置 |
| :--- | :--- | :--- |
| Codex | 桌面端生成标题 | `~/.codex/sqlite/codex-dev.db` → `local_thread_catalog.display_title` |
| WorkBuddy | 会话内 ai-title 事件 | 会话 JSONL |
| Gemini | Antigravity 生成标题 | `~/.gemini/antigravity/agyhub_summaries_proto.pb`（protobuf 手工解析） |
| DSH | 生成标题 | `~/.dsh/storages/session_projcache/sessions/*.json` → `rows.title.val` |
| Pi | 无生成源，回退第一句话（30 字） | — |

所有适配器带 60 秒缓存；云端存量标题通过一次性回填脚本更新。

## 7. 分享安全增强

- 访问码默认开启：留空时前端自动生成 6 位随机码并拼入链接
- 查看次数上限：`maxViews`（默认 50），`/s/:id/sessions` 每次访问 `recordView` 计数，超限返回 410 `view_limit`
- 分享归属 ownerId：member 分享列表仅见自己的

## 8. 回收站

- 删除本地会话 → 备份至 `hub-data/deleted-backups/<agent>/`
- 自动清理：服务启动 + 每小时，删除 mtime 超 30 天的备份
- 手动：资产库右上角回收站弹窗（单条彻底删除 / 清空分组 / 清空全部）
