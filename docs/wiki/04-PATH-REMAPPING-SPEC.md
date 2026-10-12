
# 04. 跨设备路径与跨系统环境重映射规范

## 1. 核心问题

当开发者在多台不同环境的设备之间切换时：
- 设备 A (macOS)：工作区路径为 `/Users/name/dev/work/yikeda-admin`，系统 Shell 为 `zsh`；
- 设备 B (Windows)：工作区路径为 `E:\work\yikeda-admin`，系统 Shell 为 `PowerShell`。

如果直接同步绝对路径，会导致：
1. **Agent 文件未找到 (404)**：当用户说“*查看上一步改动的 package.json*”，Agent 会读取不存在的 macOS 绝对路径；
2. **命令执行语法错误**：macOS 产生的 Bash 专有脚本在 Windows 下直接报错。

---

## 2. 映射原则与机制

### 2.1 云端/存储态：去绝对化 (Canonical Relative Path)
在上传或导出到标准会话时，所有消息文本与工具调用参数中的工作区文件路径，全部通过 `PathRemapper.toRelative(absPath, projectRoot)` 转为相对路径：
- `E:\work\yikeda-admin\src\main.ts` ➡️ `${PROJECT_ROOT}/src/main.ts`

### 2.2 注入态：动态还原 (Dynamic Rebase)
在将标准会话写入新设备的本地助手时，通过当前主机的真实 `localProjectRoot` 动态拼装：
- `${PROJECT_ROOT}/src/main.ts` ➡️ `/Users/name/dev/work/yikeda-admin/src/main.ts`

### 2.3 匹配规则优先级
1. **Git Remote URL 完全匹配**（最可靠，不受本地文件夹重命名影响）；
2. **项目目录名匹配**（例如文件夹同名均为 `yikeda-admin`）；
3. **用户手动配置表 (`devices.json` / 网页控制台映射配置)**。

