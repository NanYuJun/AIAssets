const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright-core');

const HUB = process.env.HUB || 'http://127.0.0.1:4891';
const IMPORT_LIMIT = parseInt(process.env.IMPORT_LIMIT || '5');
const profile = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');

async function main() {
  console.log('step: hub auth');
  // Hub 凭据
  const cfgPath = path.join(process.env.APPDATA, 'aiassets', 'config', 'client-config.json');
  let hubToken = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).token;
  if (process.env.HUB_USER && process.env.HUB_PASSWORD) {
    const lr = await fetch(HUB + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: process.env.HUB_USER, password: process.env.HUB_PASSWORD, deviceToken: true, deviceName: 'chatgpt-importer' }) });
    const lj = await lr.json();
    if (!lj.success) throw new Error('Hub 登录失败: ' + (lj.error || ''));
    hubToken = lj.deviceToken;
  }






  const sysProxy = process.env.HTTPS_PROXY || 'http://127.0.0.1:7897';
  console.log('step: launching browser');
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 }, proxy: { server: sysProxy } });
  const page = ctx.pages()[0] || await ctx.newPage();

  console.log('step: goto chatgpt');
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  const evalFetch = async (url) => page.evaluate(async ({ url, tk }) => {
    const r = await fetch(url, { headers: tk ? { authorization: 'Bearer ' + tk, accept: 'application/json' } : { accept: 'application/json' } });
    return { status: r.status, body: await r.text() };
  }, { url, tk: accessToken });

  // 4) 探测 + 列出会话
  const accessToken = null; // cookie 模式下不需要 Bearer
  const probe = await evalFetch('/backend-api/conversations?offset=0&limit=1');
  if (probe.status !== 200) throw new Error('token 验证失败 status=' + probe.status);
  const convos = JSON.parse(probe.body);
  const items = (convos.items || []).filter(c => c.title);
  console.log('找到会话:', items.length);

  // 5) Codex 专用端点探测
  for (const ep of ['/backend-api/codex/tasks', '/backend-api/codex/threads']) {
    const r = await evalFetch(ep);
    console.log('codex probe', ep, '→', r.status);
  }

  // 6) Hub 登录拿导入凭据
  const lr = await fetch(HUB + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: process.env.HUB_USER, password: process.env.HUB_PASSWORD, deviceToken: true, deviceName: 'chatgpt-importer' }) });
  const lj = await lr.json();
  if (!lj.success) throw new Error('Hub 登录失败: ' + (lj.error || ''));
  hubToken = lj.deviceToken;

  // 7) 逐个拉详情并导入
  let imported = 0;
  for (const c of items.slice(0, IMPORT_LIMIT)) {
    try {
      const detail = await evalFetch('/backend-api/conversation/' + c.id);
      if (detail.status !== 200) throw new Error('detail ' + detail.status);
      const d = JSON.parse(detail.body);
      const canonical = toCanonical(d, c);
      const res = await fetch(HUB + '/api/sessions/import-incoming', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + hubToken },
        body: JSON.stringify({ session: canonical })
      });
      const j = await res.json();
      if (j.success) { imported++; console.log('✓', canonical.title); }
      else console.log('✗', c.title, j.error);
    } catch (e) { console.log('✗', c.title, e.message); }
  }
  console.log('导入完成:', imported, '/', Math.min(items.length, IMPORT_LIMIT));
  await ctx.close();

  function toCanonical(detail, meta) {
    const events = [];
    const nodes = Object.values(detail.mapping || {});
    for (const node of nodes) {
      const m = node.message;
      if (!m || m.hidden) continue;
      const role = m.author?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const parts = m.content?.parts || [];
      const text = parts.filter(p => typeof p === 'string' || p?.content_type === 'text').map(p => typeof p === 'string' ? p : p.text).join('\n').trim();
      if (!text) continue;
      events.push({ kind: 'message', role, timestamp: m.create_time ? m.create_time * 1000 : Date.now(), content: text });
    }
    events.sort((a, b) => a.timestamp - b.timestamp);
    return {
      schemaVersion: 1,
      id: 'chatgpt-' + meta.id,
      title: (detail.title || meta.title || 'ChatGPT 对话').slice(0, 80),
      createdAt: detail.create_time ? detail.create_time * 1000 : Date.now(),
      updatedAt: detail.update_time ? detail.update_time * 1000 : Date.now(),
      sourceAgent: 'chatgpt',
      project: { name: 'ChatGPT 导入', originalCwd: '' },
      events,
      messages: events.filter(e => e.kind === 'message'),
      metadata: { chatgpt: { id: meta.id } }
    };
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
