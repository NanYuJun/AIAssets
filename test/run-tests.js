import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Cleaner } from '../src/core/cleaner.js';
import { PathRemapper } from '../src/core/path-remapper.js';
import { ConfigManager } from '../src/core/config.js';
import { querySqlite } from '../src/core/sqlite.js';
import { computeWorkBuddySlug } from '../src/adapters/workbuddy/slug.js';
import { CodexReader } from '../src/adapters/codex/reader.js';
import { WorkBuddyReader } from '../src/adapters/workbuddy/reader.js';
import { WorkBuddyWriter } from '../src/adapters/workbuddy/writer.js';

async function runTests() {
  console.log('🧪 开始执行 Agent Sync Hub 单元与集成测试 (Phase 1 + Phase 2)...\n');

  // Test 1: Cleaner
  console.log('▶ [Test 1] 验证 Cleaner 提示词降噪');
  const dirtyPrompt = `<INSTRUCTIONS>secret prompt</INSTRUCTIONS><skills_instructions>skills</skills_instructions>修复用户登录接口`;
  const cleanResult = Cleaner.cleanUserMessage(dirtyPrompt);
  assert.strictEqual(cleanResult, '修复用户登录接口');
  console.log('  ✅ 成功剥离 XML 标记与系统注入');

  // Test 2: PathRemapper
  console.log('▶ [Test 2] 验证 PathRemapper 路径规范化与跨设备还原');
  const absWinPath = 'E:/work/yikeda-admin/src/views/index.vue';
  const projectRoot = 'E:/work/yikeda-admin';
  const canonical = PathRemapper.toCanonical(absWinPath, projectRoot);
  assert.strictEqual(canonical, '${PROJECT_ROOT}/src/views/index.vue');
  const restored = PathRemapper.toLocal(canonical, 'D:/work/yikeda-admin');
  assert.strictEqual(restored.replace(/\\/g, '/'), 'D:/work/yikeda-admin/src/views/index.vue');
  console.log('  ✅ 路径相对化与跨平台还原正常');

  // Test 3: Slug computation
  console.log('▶ [Test 3] 验证 WorkBuddy Slug 算法');
  assert.strictEqual(computeWorkBuddySlug('E:\\example\\1Ton'), 'e-example-1Ton');
  assert.strictEqual(computeWorkBuddySlug('C:\\Users\\yourname\\WorkBuddy\\demo'), 'c-Users-yourname-WorkBuddy-demo');
  console.log('  ✅ Slug 计算与 WorkBuddy 规则 100% 一致');

  // Test 4: ConfigManager & Cross-device Rebase
  console.log('▶ [Test 4] 验证 Phase 2 跨设备路径映射与 Rebase');
  const testCfgPath = path.resolve('work/test-sync-config.json');
  process.env.AGENT_SYNC_CONFIG = testCfgPath;
  ConfigManager.registerDevice('mac-book', 'MacBook M3');
  ConfigManager.addProjectMapping('warehouse', {
    'win-desktop': 'E:/work/warehouse',
    'mac-book': '/Users/dev/projects/warehouse'
  });
  const resolvedTarget = ConfigManager.resolveTargetProjectRoot('E:/work/warehouse', 'mac-book');
  assert.strictEqual(resolvedTarget, '/Users/dev/projects/warehouse');

  const dummySession = {
    schemaVersion: 1,
    id: 'test-session',
    title: '跨设备测试',
    project: { originalCwd: 'E:/work/warehouse' },
    events: [
      {
        kind: 'message',
        role: 'user',
        content: '查看 E:/work/warehouse/src/App.vue 的代码'
      },
      {
        kind: 'tool_call',
        callId: 'call_1',
        name: 'Bash',
        arguments: JSON.stringify({ command: 'cat E:/work/warehouse/src/App.vue' })
      }
    ]
  };

  const rebased = PathRemapper.rebaseSession(dummySession, resolvedTarget);
  assert.strictEqual(rebased.project.originalCwd, '/Users/dev/projects/warehouse');
  assert.strictEqual(rebased.events[0].content, '查看 /Users/dev/projects/warehouse/src/App.vue 的代码');
  assert(rebased.events[1].arguments.includes('/Users/dev/projects/warehouse/src/App.vue'));
  console.log('  ✅ 跨设备会话 Rebase 成功，所有工作区绝对路径均已动态重定向至目标设备路径');

  // Test 5: CodexReader on real session
  console.log('▶ [Test 5] 验证 CodexReader 真实历史会话及执行过程解析');
  const sessions = CodexReader.scanAllSessions();
  assert(sessions.length > 0, '应至少找到一个本地 Codex 会话');
  const sample = await CodexReader.parseSession(sessions[0]);
  assert(sample.id, '会话必须有 ID');
  assert(sample.events.length > 0, '会话必须包含有效事件序列');
  console.log(`  ✅ 成功解析真实会话: ${sample.id} (共 ${sample.events.length} 个事件项，含消息与工具执行)`);

  // Test 6: Real-time project providers
  console.log('▶ [Test 6] 验证 Codex 与 WorkBuddy 项目数据库实时读取');
  const projectFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-projects-'));
  const codexHome = path.join(projectFixtureRoot, 'codex');
  const workBuddyHome = path.join(projectFixtureRoot, 'workbuddy');
  const workspacePath = path.join(projectFixtureRoot, 'workspace');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(workBuddyHome, { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });

  const fixtureScript = String.raw`
import sqlite3
import sys

codex_db, workbuddy_db, workspace = sys.argv[1:]
connection = sqlite3.connect(codex_db)
connection.executescript('''
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, metadata TEXT, position INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER);
CREATE TABLE project_roots (project_id TEXT, position INTEGER, path TEXT);
''')
connection.execute('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)', ('project-1', '测试项目名称', '{}', 0, 1000, 2000))
connection.execute('INSERT INTO project_roots VALUES (?, ?, ?)', ('project-1', 0, workspace))
connection.commit()
connection.close()

connection = sqlite3.connect(workbuddy_db)
connection.execute('CREATE TABLE workspaces (path TEXT, last_opened_at INTEGER)')
connection.execute('INSERT INTO workspaces VALUES (?, ?)', (workspace, 3000))
connection.commit()
connection.close()
`;
  execFileSync('python', ['-c', fixtureScript, path.join(codexHome, 'state_5.sqlite'), path.join(workBuddyHome, 'workbuddy.db'), workspacePath]);

  const previousCodexHome = process.env.CODEX_HOME;
  const previousWorkBuddyHome = process.env.WORKBUDDY_HOME;
  try {
    process.env.CODEX_HOME = codexHome;
    process.env.WORKBUDDY_HOME = workBuddyHome;
    const codexProjects = CodexReader.listProjects();
    const workBuddyProjects = WorkBuddyReader.listProjects();
    assert.strictEqual(codexProjects.length, 1);
    assert.strictEqual(codexProjects[0].label, '测试项目名称');
    assert.strictEqual(codexProjects[0].source, 'codex_state_db');
    assert.strictEqual(workBuddyProjects.length, 1);
    assert.strictEqual(workBuddyProjects[0].path, workspacePath.replace(/[\\/]+/g, '/'));
    assert.strictEqual(workBuddyProjects[0].source, 'workbuddy_db');
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousWorkBuddyHome === undefined) delete process.env.WORKBUDDY_HOME;
    else process.env.WORKBUDDY_HOME = previousWorkBuddyHome;
    fs.rmSync(projectFixtureRoot, { recursive: true, force: true });
  }
  console.log('  ✅ 两个 Agent 的项目均来自各自 SQLite 数据库，无静态项目表参与');

  // Test 7: WorkBuddyWriter End-to-End
  console.log('▶ [Test 7] 验证 WorkBuddyWriter 端到端全量执行过程与事件链注入');
  const mockWbDir = path.resolve('work/mock-workbuddy');
  if (fs.existsSync(mockWbDir)) {
    fs.rmSync(mockWbDir, { recursive: true, force: true });
  }
  fs.mkdirSync(mockWbDir, { recursive: true });
  const mockWbDb = path.join(mockWbDir, 'workbuddy.db');
  const sessionSchemaScript = String.raw`
import sqlite3
import sys

connection = sqlite3.connect(sys.argv[1])
connection.execute('''
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT,
  custom_title TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_activity_at INTEGER,
  deleted_at INTEGER,
  is_playground INTEGER NOT NULL,
  source_mode TEXT,
  mode TEXT,
  model TEXT,
  permission_mode TEXT,
  use_sandbox_cli INTEGER,
  thought_level TEXT,
  transport TEXT NOT NULL,
  unread INTEGER NOT NULL
)
''')
connection.commit()
connection.close()
`;
  execFileSync('python', ['-c', sessionSchemaScript, mockWbDb]);

  const chineseTitleSample = { ...sample, title: '被约谈降薪怎么办' };
  const injectRes = await WorkBuddyWriter.injectSession(chineseTitleSample, 'E:/work/1Ton', {
    workBuddyDir: mockWbDir
  });

  assert(fs.existsSync(injectRes.jsonlPath), '必须生成目标 JSONL 文件');
  const jsonlLines = fs.readFileSync(injectRes.jsonlPath, 'utf-8').trim().split('\n');
  assert.strictEqual(jsonlLines.length, injectRes.eventCount, '生成的行数必须精准对应全部事件数');
  
  const firstLine = JSON.parse(jsonlLines[0]);
  assert.strictEqual(firstLine.type, 'message');
  assert.strictEqual(firstLine.role, 'user');
  const indexedRows = querySqlite(mockWbDb, 'SELECT id, cwd, title, custom_title FROM sessions WHERE id = ?', [sample.id]);
  assert.strictEqual(indexedRows.length, 1, '必须将注入会话写入 WorkBuddy sessions 索引');
  assert.strictEqual(indexedRows[0].title, '被约谈降薪怎么办');
  assert.strictEqual(indexedRows[0].custom_title, '被约谈降薪怎么办');
  console.log(`  ✅ 成功在 ${injectRes.jsonlPath} 生成包含全部执行过程的 JSONL 数据 (共 ${jsonlLines.length} 行)`);

  console.log('\n🎉 所有 7 项核心测试全部顺利通过 (7/7 Passed)！');
}

runTests().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
