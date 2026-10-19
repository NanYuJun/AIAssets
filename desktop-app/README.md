# AIAssets Desktop

AIAssets 的 Electron 轻客户端。连接中心 Hub，自动同步本机 AI Agent 会话。

## 功能

- 首次配对：填 Hub 地址 + Token，验证连通性
- 自动同步：每 60 秒轮询，推本地新会话 + 拉云端新会话
- 托盘常驻：关闭窗口不退出，右键托盘菜单操作
- 手动同步：托盘右键 -> 立即同步
- 内置浏览器：连接成功后直接打开 Hub Web UI

## 构建

前置：Node.js 24+、pnpm

```bash
pnpm install
pnpm run build:win     # Windows NSIS 安装包
pnpm run build:mac     # macOS DMG
```

产物在 dist/ 下：

- AIAssets Setup 1.0.0.exe（约 78 MB）
- AIAssets-1.0.0.dmg

## 使用

1. 安装后启动，自动打开配对窗口
2. 填入中心 Hub 地址（如 http://192.168.1.100:4891）
3. 填入在 Hub 设置页生成的 Token
4. 勾选自动同步，点击保存并连接
5. 自动跳转到 Hub Web UI，托盘常驻

## 配置文件位置

- Windows: %APPDATA%/aiassets-desktop/config/client-config.json
- macOS: ~/Library/Application Support/aiassets-desktop/config/client-config.json

## 开发调试

```bash
pnpm start
```
