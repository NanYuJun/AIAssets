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
pnpm run build:mac     # macOS DMG + ZIP（Intel + Apple Silicon）
```

产物在 dist/ 下：

- AIAssets Setup 1.0.0.exe（约 78 MB）
- AIAssets-1.0.0.dmg / AIAssets-1.0.0-arm64.dmg（Intel / Apple Silicon）
- AIAssets-1.0.0-mac.zip / AIAssets-1.0.0-arm64-mac.zip（自动更新用）
- latest-mac.yml（macOS 自动更新元数据）

应用图标为 `build/icon.png`（1024×1024）与 `build/icon.icns`；改动图标后重新生成 icns：

```bash
mkdir -p /tmp/aia.iconset
for s in 16 32 128 256 512; do
  sips -s format png -z $s $s build/icon.png --out /tmp/aia.iconset/icon_${s}x${s}.png
  sips -s format png -z $((s*2)) $((s*2)) build/icon.png --out /tmp/aia.iconset/icon_${s}x${s}@2x.png
done
iconutil -c icns /tmp/aia.iconset -o build/icon.icns
```

安装包未签名：首次打开需右键「打开」，或执行 `xattr -dr com.apple.quarantine /Applications/AIAssets.app`。

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
