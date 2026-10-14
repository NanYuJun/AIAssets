# ChatGPT 对话导入到 AIAssets（控制台脚本）

## 使用方法

1. 在已登录 chatgpt.com 的浏览器标签页里，按 **F12** 打开控制台
2. 粘贴下方代码并回车执行
3. 会话会自动推送到你的 AIAssets Hub

## 前置：先修改两行

把代码开头的 `HUB` 改为你的 AIAssets 地址，`TOKEN` 改为 AIAssets 设置页生成的设备 Token。

## 代码

```javascript
(async () => {
  const HUB = 'http://192.168.31.45:4891';
  const TOKEN = '把你的AIAssets设备Token粘贴在这里';
  const LIMIT = 20;
  const auth = { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' };
  const list = await fetch('/backend-api/conversations?offset=0&limit=' + LIMIT + '&order=updated').then(r => r.json());
  let done = 0;
  for (const c of (list.items || [])) {
    try {
      const d = await fetch('/backend-api/conversation/' + c.id).then(r => r.json());
      const events = [];
      for (const node of Object.values(d.mapping || {})) {
        const m = node.message; if (!m || m.hidden) continue;
        const role = m.author?.role; if (role !== 'user' && role !== 'assistant') continue;
        const text = (m.content?.parts || []).filter(p => typeof p === 'string' || p?.content_type === 'text').map(p => typeof p === 'string' ? p : p.text).join('\n').trim();
        if (!text) continue;
        events.push({ kind: 'message', role, timestamp: (m.create_time || 0) * 1000, content: text });
      }
      events.sort((a, b) => a.timestamp - b.timestamp);
      if (!events.length) continue;
      const res = await fetch(HUB + '/api/sessions/import-incoming', { method: 'POST', headers: auth, body: JSON.stringify({ session: {
        schemaVersion: 1, id: 'chatgpt-' + c.id, title: (d.title || c.title || 'ChatGPT 对话').slice(0, 80),
        createdAt: (d.create_time || 0) * 1000, updatedAt: (d.update_time || 0) * 1000, sourceAgent: 'chatgpt',
        project: { name: 'ChatGPT 导入', originalCwd: '' }, events, messages: events,
        metadata: { chatgpt: { id: c.id } } }) });
      const j = await res.json(); console.log(j.success ? '✓' : '✗', d.title || c.title); if (j.success) done++;
    } catch (e) { console.log('✗', c.title, e.message); }
  }
  console.log('导入完成:', done);
})();
```
