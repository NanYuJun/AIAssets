
# 08. Phase 2 跨设备路径映射配置规范

## 1. 目标与解决的痛点

在多设备切换场景下，不同电脑的磁盘结构、用户名和操作系统各不相同：
- **设备 A (Windows 工作机)**：项目路径为 `E:\work\example-warehouse`
- **设备 B (MacBook 笔记本)**：项目路径为 `/Users/yourname/dev/example-warehouse`

如果不做映射直接导入，WorkBuddy/Codex 恢复会话时将依然保留原设备的绝对路径，导致工具调用报 `File Not Found` 且无法正确定位到当前工程。

Phase 2 旨在建立**设备配置文件 (`sync-config.json`) 与动态项目重定位引擎**。

---

## 2. 配置文件设计 (`sync-config.json`)

配置文件保存在用户根目录或应用工作目录下：

```json
{
  "version": 1,
  "currentDeviceId": "dev-win-01",
  "devices": {
    "dev-win-01": {
      "name": "公司台式机 (Windows)",
      "os": "win32",
      "shell": "powershell"
    },
    "dev-mac-01": {
      "name": "个人笔记本 (MacBook Pro)",
      "os": "darwin",
      "shell": "zsh"
    }
  },
  "projectMappings": [
    {
      "projectId": "example-warehouse",
      "gitRemote": "git@github.com:cobazaar/warehouse.git",
      "paths": {
        "dev-win-01": "E:/work/example-warehouse",
        "dev-mac-01": "/Users/yourname/dev/example-warehouse"
      }
    }
  ]
}
```

---

## 3. 动态路径映射与重定位策略

当从设备 A 导出并在设备 B 上注入时：
1. **自动识别项目**：通过 Git Remote URL 或项目标识符匹配到对应的 `projectMapping`；
2. **文本与工具参数重映射**：
   - 提取时：将本地路径转换为标准化占位符 `${PROJECT_ROOT}/src/...`；
   - 注入时：读取目标设备的真实路径，将占位符替换为目标设备的绝对路径；
3. **CWD 重写**：所有生成消息的 `cwd` 属性自动变更为目标设备的真实工作区路径。

---

## 4. CLI 交互命令规划

```bash
# 查看当前设备与路径映射配置
node src/cli/index.js config show

# 注册当前设备标识
node src/cli/index.js config set-device <deviceId> <deviceName>

# 添加跨设备项目路径绑定
node src/cli/index.js config map-project <projectId> --device <deviceId> --path <localPath>
```
