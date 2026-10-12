// 用法: node make-latest.cjs  (在 desktop-app/dist 构建后运行)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pkg = require('./package.json');
const dist = path.join(__dirname, 'dist');
const exeName = fs.readdirSync(dist).find(f => f.startsWith('AIAssets Setup') && f.endsWith('.exe'));
if (!exeName) { console.error('未找到安装包 exe'); process.exit(1); }
const exePath = path.join(dist, exeName);
const sha512 = crypto.createHash('sha512').update(fs.readFileSync(exePath)).digest('base64');
const size = fs.statSync(exePath).size;
const yml = [
  'version: ' + pkg.version,
  'path: ' + exeName,
  'sha512: ' + sha512,
  'releaseDate: ' + new Date().toISOString(),
  '',
  'files:',
  '  - url: ' + exeName,
    '    sha512: ' + sha512,
    '    size: ' + size
].join('\n');
fs.writeFileSync(path.join(dist, 'latest.yml'), yml, 'utf8');
console.log('latest.yml 生成完成:');
console.log(yml);
