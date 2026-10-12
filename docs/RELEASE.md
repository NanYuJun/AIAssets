# AIAssets 发布流程（GitHub Releases）

## 一次性配置

1. 在 GitHub 创建仓库（如 `yourname/AIAssets`）
2. 修改 `desktop-app/package.json` → `build.publish` 里的 `owner` / `repo` 为你的仓库地址：

   ```json
   "publish": [{ "provider": "github", "owner": "yourname", "repo": "AIAssets" }]
   ```

3. 提交并推送（GitHub Actions 已配置在 `.github/workflows/release.yml`）

## 发布新版本

1. 更新 `desktop-app/package.json` 的 `version`（如 `1.0.1`）
2. 提交并打标签推送：

   ```bash
   git commit -am "release: v1.0.1"
   git tag v1.0.1
   git push origin main --tags
   ```

3. GitHub Actions 自动构建并创建 Release，附件包含：
   - `latest.yml`（更新元数据）
   - `AIAssets Setup <版本>.exe`
   - `*.blockmap`（增量下载）

## 客户端如何更新

- 已配置 GitHub 发布的：客户端启动后自动从 GitHub Releases 检查并下载
- 未配置 / GitHub 不可达：自动回退到 Hub 分发源（`<hub>/updates/`，手动拷贝 `latest.yml + exe + blockmap` 到 Hub 的 `hub-data/updates/`）

## 注意事项

- 版本号必须递增（tag 与 package.json 保持一致）
- 未签名安装包会弹 SmartScreen，选择「更多信息 → 仍要运行」
- 免费账号 Actions 每月 2000 分钟，本构建约 5 分钟/次，足够用
- 私有仓库的 Release 下载需要 Token，**公开仓库**才能让所有用户自动更新
