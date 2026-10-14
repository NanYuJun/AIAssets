const { chromium } = require('playwright-core');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const profile = path.join(os.homedir(), '.aiassets', 'chatgpt-profile-chrome');
(async () => {
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://chatgpt.com/');
  console.log('请在打开的浏览器里登录 ChatGPT，登录成功后回到这里按 Enter...');
  await new Promise(r => process.stdin.once('data', r));
  const session = await page.evaluate(async () => {
    const r = await fetch('/api/auth/session');
    return await r.json();
  });
  if (session.accessToken) {
    console.log('登录成功，token 已保存到 .aiassets/chatgpt-token.json');
    fs.mkdirSync(path.join(os.homedir(), '.aiassets'), { recursive: true });
    require('node:fs').writeFileSync(path.join(os.homedir(), '.aiassets', 'chatgpt-token.json'), JSON.stringify({ accessToken: session.accessToken, expires: session.expires }, null, 2));
  } else {
    console.log('未获取到 accessToken，请确认已登录');
  }
  await ctx.close();
})().catch(e => console.error('FAIL:', e.message));
