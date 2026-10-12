import fs from 'node:fs';
import path from 'node:path';
import { CodexReader } from '../adapters/codex/reader.js';
import { WorkBuddyWriter } from '../adapters/workbuddy/writer.js';
import { ConfigManager } from '../core/config.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  if (command === 'serve' || command === 'web') {
    const port = args[1] || '4891';
    process.env.PORT = port;
    console.log(`🌐 正在启动 Agent Sync Hub Web 控制台 (端口: ${port})...`);
    await import('../server/index.js');
    return;
  }

  if (command === 'list') {
    console.log('🔍 正在扫描本机 Codex 对话记录...');
    const files = CodexReader.scanAllSessions();
    console.log(`✅ 共发现 ${files.length} 个历史会话文件：\n`);

    for (let i = 0; i < Math.min(files.length, 5); i++) {
      const file = files[i];
      try {
        const session = await CodexReader.parseSession(file);
        const dateStr = new Date(session.updatedAt).toLocaleString();
        console.log(`[${i + 1}] ID: ${session.id}`);
        console.log(`    标题: ${session.title || '（未命名会话）'}`);
        console.log(`    消息数: ${session.messages.length} | 更新时间: ${dateStr}`);
        console.log(`    工作目录: ${session.project.originalCwd}`);
        console.log(`    文件路径: ${file}\n`);
      } catch (err) {}
    }
    if (files.length > 5) {
      console.log(`... 还有 ${files.length - 5} 个会话未展开展示`);
    }
    return;
  }

  if (command === 'export') {
    const sessionId = args[1];
    if (!sessionId) {
      console.error('❌ 请提供 session ID，例如: node src/cli/index.js export <sessionId>');
      process.exit(1);
    }

    const files = CodexReader.scanAllSessions();
    const targetFile = files.find(f => f.includes(sessionId));
    if (!targetFile) {
      console.error(`❌ 未找到匹配的会话文件: ${sessionId}`);
      process.exit(1);
    }

    console.log(`📖 正在解析会话: ${targetFile}`);
    const canonical = await CodexReader.parseSession(targetFile);
    const outputPath = args[2] || `canonical-${canonical.id}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(canonical, null, 2), 'utf-8');
    console.log(`🎉 导出成功！标准会话格式已保存至: ${outputPath}`);
    return;
  }

  if (command === 'to-workbuddy') {
    let targetProject = args[1];
    const requestedId = args[2];

    const files = CodexReader.scanAllSessions();
    let targetFile = files[0];

    if (requestedId) {
      const found = files.find(f => f.includes(requestedId));
      if (!found) {
        console.error(`❌ 未找到指定的会话 ID: ${requestedId}`);
        process.exit(1);
      }
      targetFile = found;
    }

    console.log(`🚀 [Codex ➡️ WorkBuddy] 正在提取会话: ${targetFile}`);
    const canonical = await CodexReader.parseSession(targetFile);

    if (!targetProject) {
      const cfg = ConfigManager.loadConfig();
      const resolved = ConfigManager.resolveTargetProjectRoot(canonical.project.originalCwd, cfg.currentDeviceId, canonical.project.gitRemote);
      if (resolved) {
        targetProject = resolved;
        console.log(`💡 依据配置文件自动匹配到目标工作区: ${targetProject}`);
      } else {
        targetProject = canonical.project.originalCwd;
        console.log(`💡 使用原始会话工作区: ${targetProject}`);
      }
    }

    console.log(`   已提取 ${canonical.messages.length} 条对话与 ${canonical.events.filter(e => e.kind.startsWith('tool_')).length / 2} 次工具执行，标题: 「${canonical.title}」`);
    console.log(`📥 正在注入到 WorkBuddy 本地工程: ${targetProject} ...`);

    const result = await WorkBuddyWriter.injectSession(canonical, targetProject);
    console.log(`🎉 注入成功！`);
    console.log(`   - 会话 ID: ${result.sessionId}`);
    console.log(`   - JSONL 产物: ${result.jsonlPath}`);
    console.log(`   - SQLite 数据库索引已更新！在 WorkBuddy 中切换至对应工程即可查看会话。\n`);
    return;
  }

  if (command === 'config') {
    const sub = args[1] || 'show';
    if (sub === 'show') {
      const cfg = ConfigManager.loadConfig();
      console.log('📋 当前同步配置状态:');
      console.log(JSON.stringify(cfg, null, 2));
      return;
    }

    if (sub === 'set-device') {
      const deviceId = args[2];
      const name = args[3] || deviceId;
      if (!deviceId) {
        console.error('❌ 请输入设备标识');
        process.exit(1);
      }
      ConfigManager.registerDevice(deviceId, name);
      console.log(`✅ 设备已登记: ${deviceId} (${name})`);
      return;
    }

    if (sub === 'map-project') {
      const projectId = args[2];
      const dev1 = args[3];
      const path1 = args[4];
      const dev2 = args[5];
      const path2 = args[6];
      if (!projectId || !dev1 || !path1) {
        console.error('❌ 用法: node src/cli/index.js config map-project <projectId> <dev1> <path1> [<dev2> <path2>]');
        process.exit(1);
      }
      const paths = { [dev1]: path1 };
      if (dev2 && path2) paths[dev2] = path2;
      ConfigManager.addProjectMapping(projectId, paths);
      console.log(`✅ 项目路径映射已更新: ${projectId}`);
      return;
    }
  }

  console.log(`
🛠️ Agent Session Sync Hub CLI

用法:
  node src/cli/index.js serve [port]
      启动本地 Web 可视化控制台 (默认: http://127.0.0.1:4891)

  node src/cli/index.js list
      列出最近的 Codex 历史会话

  node src/cli/index.js export <sessionId> [outputPath]
      将指定会话导出为规范的 Canonical JSON 格式

  node src/cli/index.js to-workbuddy [targetProjectRoot] [sessionId]
      将 Codex 会话（默认最新）直接转换并热注入到 WorkBuddy 工程

  node src/cli/index.js config show
      显示多设备与路径映射配置表

  node src/cli/index.js config map-project <projectId> <dev1> <path1> [<dev2> <path2>]
      绑定跨设备的工作区路径对照表
`);
}

main().catch(err => {
  console.error('❌ 运行出错:', err);
  process.exit(1);
});
