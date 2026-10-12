# AIAssets Frontend

React 19 + Vite + Tailwind CSS 4 前端，构建产物由 Hub 服务端托管（Web 版）与 Electron 桌面端内嵌（桌面版）。

## 页面结构

| 路由 | 页面 | 说明 |
| :--- | :--- | :--- |
| `#/sessions` | 会话仓库 | 本地 + 云端会话统一管理、迁移、预览 |
| `#/collections` | 会话集 | 按主题分组打包、分享、导出 |
| `#/shares` | 分享管理 | 分享链接、访问码、查看次数、撤销 |
| `#/account` | 我的账号 | 昵称/头像、修改密码、我的设备 |
| `#/useradmin` | 用户管理 | 仅 admin 可见 |
| `#/settings` | 设置 | 同步云端、容灾备份、存储统计、日志 |

## 构建

```bash
pnpm install
pnpm run build            # Hub Web 版 → ../src/server/public-react/
pnpm run build:electron   # 桌面版 → ../desktop-app/app-ui/（相对路径）
```

## 开发

```bash
pnpm run dev              # 启动 Vite dev server（API 代理到 127.0.0.1:4891）
```
