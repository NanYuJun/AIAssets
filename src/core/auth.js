import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SCRYPT_KEYLEN = 32;

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f97316', '#6366f1'];

function avatarColorFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export class AuthManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.usersPath = path.join(dataDir, 'users.json');
    this.legacyCredentialsPath = path.join(dataDir, 'auth-credentials.json');
    this.tokensPath = path.join(dataDir, 'auth-tokens.json');
  }

  get users() {
    if (fs.existsSync(this.usersPath)) {
      try { return JSON.parse(fs.readFileSync(this.usersPath, 'utf-8')); } catch {}
    }
    // 兼容：迁移旧版单用户 auth-credentials.json 到多用户 users.json
    if (fs.existsSync(this.legacyCredentialsPath)) {
      try {
        const legacy = JSON.parse(fs.readFileSync(this.legacyCredentialsPath, 'utf-8'));
        if (legacy.username && legacy.passwordHash && legacy.salt) {
          const users = [{ id: 'u_admin', username: legacy.username, passwordHash: legacy.passwordHash, salt: legacy.salt, role: 'admin', createdAt: legacy.createdAt || Date.now() }];
          fs.writeFileSync(this.usersPath, JSON.stringify(users, null, 2), 'utf-8');
          return users;
        }
      } catch {}
    }
    return [];
  }

  saveUsers(users) {
    fs.writeFileSync(this.usersPath, JSON.stringify(users, null, 2), 'utf-8');
  }

  get tokens() {
    if (!fs.existsSync(this.tokensPath)) return {};
    try { return JSON.parse(fs.readFileSync(this.tokensPath, 'utf-8')); } catch { return {}; }
  }

  saveTokens(tokens) {
    fs.writeFileSync(this.tokensPath, JSON.stringify(tokens, null, 2), 'utf-8');
  }

  isConfigured() {
    return this.users.length > 0;
  }

  setup(username, password) {
    const users = this.users;
    if (users.length > 0) throw new Error('账号已初始化，如需重置请先删除 users.json');
    if (typeof username !== 'string' || username.trim().length < 2) throw new Error('用户名至少 2 个字符');
    if (typeof password !== 'string' || password.length < 8) throw new Error('密码至少 8 个字符');
    const salt = crypto.randomBytes(16).toString('hex');
    const user = { id: 'u_' + crypto.randomBytes(4).toString('hex'), username: username.trim(), salt, passwordHash: hashPassword(password, salt), role: 'admin', displayName: username.trim(), avatarColor: avatarColorFor(username.trim()), status: 'active', createdAt: Date.now() };
    users.push(user);
    this.saveUsers(users);
    return { userId: user.id, username: user.username, role: user.role };
  }

  verify(username, password) {
    const users = this.users;
    if (users.length === 0) throw new Error('尚未初始化账号');
    const user = users.find(u => u.username === String(username || ''));
    if (!user) return null;
    if (user.status === 'disabled') { throw new Error('账号已被禁用'); }
    if (!timingSafeEqual(user.passwordHash, hashPassword(password || '', user.salt))) return null;
    user.lastLoginAt = Date.now();
    this.saveUsers(users);
    return { userId: user.id, username: user.username, role: user.role };
  }

  // ===== 多用户管理 =====

  listUsers() {
    return this.users.map(u => ({ id: u.id, username: u.username, role: u.role, displayName: u.displayName || u.username, avatarColor: u.avatarColor || avatarColorFor(u.username), status: u.status || 'active', createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null }));
  }

  updateProfile(userId, { displayName, avatarColor }) {
    const users = this.users;
    const user = users.find(u => u.id === userId);
    if (!user) return false;
    if (displayName !== undefined) {
      const dn = String(displayName).trim().slice(0, 30);
      if (dn) user.displayName = dn;
    }
    if (avatarColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(String(avatarColor))) {
      user.avatarColor = String(avatarColor);
    }
    this.saveUsers(users);
    return true;
  }

  setStatus(userId, status) {
    if (!['active', 'disabled'].includes(status)) return false;
    const users = this.users;
    const user = users.find(u => u.id === userId);
    if (!user) return false;
    user.status = status;
    this.saveUsers(users);
    if (status === 'disabled') {
      const tokens = this.tokens;
      for (const [t, meta] of Object.entries(tokens)) {
        if (meta.userId === userId) delete tokens[t];
      }
      this.saveTokens(tokens);
    }
    return true;
  }

  addUser(username, password, role = 'member') {
    const users = this.users;
    if (users.some(u => u.username === String(username || '').trim())) throw new Error('用户名已存在');
    if (typeof username !== 'string' || username.trim().length < 2) throw new Error('用户名至少 2 个字符');
    if (typeof password !== 'string' || password.length < 8) throw new Error('密码至少 8 个字符');
    if (!['admin','member'].includes(role)) throw new Error('角色必须是 admin 或 member');
    const salt = crypto.randomBytes(16).toString('hex');
    const user = { id: 'u_' + crypto.randomBytes(4).toString('hex'), username: username.trim(), salt, passwordHash: hashPassword(password, salt), role, displayName: username.trim(), avatarColor: avatarColorFor(username.trim()), status: 'active', createdAt: Date.now() };
    users.push(user);
    this.saveUsers(users);
    return { userId: user.id, username: user.username, role: user.role };
  }

  removeUser(userId) {
    const users = this.users;
    if (users.length <= 1) throw new Error('至少保留一个账号');
    const idx = users.findIndex(u => u.id === userId);
    if (idx < 0) return false;
    if (users[idx].role === 'admin' && users.filter(u => u.role === 'admin').length === 1) throw new Error('至少保留一个 admin');
    users.splice(idx, 1);
    this.saveUsers(users);
    // 吊销该用户所有 Token
    const tokens = this.tokens;
    for (const [t, meta] of Object.entries(tokens)) {
      if (meta.userId === userId) delete tokens[t];
    }
    this.saveTokens(tokens);
    return true;
  }

  getUserById(userId) {
    return this.users.find(u => u.id === userId) || null;
  }

  // ===== Token（挂 userId）=====

  issueToken(label = '', userId = null, type = 'device') {
    const token = crypto.randomBytes(32).toString('hex');
    const tokens = this.tokens;
    tokens[token] = { label: String(label || '').slice(0, 50), userId, type, createdAt: Date.now() };
    this.saveTokens(tokens);
    return token;
  }

  verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    return this.tokens[token] || null;
  }

  revokeToken(token) {
    const tokens = this.tokens;
    if (!tokens[token]) return false;
    delete tokens[token];
    this.saveTokens(tokens);
    return true;
  }

  listTokens() {
    const users = this.users;
    return Object.entries(this.tokens).map(([token, meta]) => ({
      tokenPreview: token.slice(0, 8) + '...',
      token,
      ...meta,
      type: meta.type || (String(meta.label || '').startsWith('device-') || meta.label === 'device' ? 'device' : 'session'),
      username: users.find(u => u.id === meta.userId)?.username || '-'
    }));
  }

  updateTokenLabel(token, label) {
    const tokens = this.tokens;
    if (!tokens[token]) return false;
    tokens[token].label = String(label || '').slice(0, 50);
    this.saveTokens(tokens);
    return true;
  }

  changePassword(userId, oldPassword, newPassword) {
    const users = this.users;
    const user = users.find(u => u.id === userId);
    if (!user) throw new Error('用户不存在');
    if (!timingSafeEqual(user.passwordHash, hashPassword(oldPassword || '', user.salt))) throw new Error('原密码错误');
    if (typeof newPassword !== 'string' || newPassword.length < 8) throw new Error('新密码至少 8 个字符');
    const salt = crypto.randomBytes(16).toString('hex');
    user.salt = salt;
    user.passwordHash = hashPassword(newPassword, salt);
    user.passwordChangedAt = Date.now();
    this.saveUsers(users);
    // 吊销该用户所有 Token
    const tokens = this.tokens;
    for (const [t, meta] of Object.entries(tokens)) {
      if (meta.userId === userId) delete tokens[t];
    }
    this.saveTokens(tokens);
    return { userId: user.id, username: user.username };
  }

  changeUserPassword(userId, newPassword) {
    const users = this.users;
    const user = users.find(u => u.id === userId);
    if (!user) throw new Error('用户不存在');
    if (typeof newPassword !== 'string' || newPassword.length < 8) throw new Error('新密码至少 8 个字符');
    const salt = crypto.randomBytes(16).toString('hex');
    user.salt = salt;
    user.passwordHash = hashPassword(newPassword, salt);
    user.passwordChangedAt = Date.now();
    this.saveUsers(users);
    return true;
  }

  pruneExpiredTokens() {
    // session Token 30 天（与 Cookie 一致），device Token 90 天
    const limits = { session: 30 * 86400000, device: 90 * 86400000, guest: 7 * 86400000 };
    const tokens = this.tokens;
    let removed = 0;
    const now = Date.now();
    for (const [token, meta] of Object.entries(tokens)) {
      const ttl = limits[meta.type || 'device'] || limits.device;
      if (now - meta.createdAt > ttl) { delete tokens[token]; removed++; }
    }
    if (removed) this.saveTokens(tokens);
    return removed;
  }

  extractToken(req, url) {
    const header = req.headers['authorization'] || '';
    if (header.startsWith('Bearer ')) return header.slice(7);
    return url.searchParams.get('token');
  }

}
