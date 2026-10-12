import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SHARE_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class ShareManager {
  constructor(dataDir) {
    this.sharesDir = path.join(dataDir, 'shares');
    if (!fs.existsSync(this.sharesDir)) fs.mkdirSync(this.sharesDir, { recursive: true });
  }

  sharePath(shareId) {
    return path.join(this.sharesDir, `${shareId}.json`);
  }

  generateShareId() {
    let id = '';
    do {
      id = Array.from(crypto.randomBytes(8))
        .map(b => SHARE_ALPHABET[b % SHARE_ALPHABET.length])
        .join('');
    } while (fs.existsSync(this.sharePath(id)));
    return id;
  }

  create({ sessionIds, expiresAt, accessCode, allowImport, createdByDevice, ownerId, maxViews }) {
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      throw new Error('分享必须包含至少一个会话');
    }
    sessionIds.forEach(id => {
      if (typeof id !== 'string' || !id || path.basename(id) !== id) {
        throw new Error('非法会话 ID');
      }
    });
    const ttl = Number(expiresAt);
    if (!Number.isFinite(ttl) || ttl <= Date.now()) {
      throw new Error('有效期必须晚于当前时间');
    }

    const shareId = this.generateShareId();
    const record = {
      shareId,
      createdAt: Date.now(),
      expiresAt: ttl,
      accessCodeHash: accessCode
        ? crypto.createHash('sha256').update(String(accessCode)).digest('hex')
        : null,
      allowImport: allowImport !== false,
      ownerId: ownerId || null,
      maxViews: Number.isFinite(maxViews) && maxViews > 0 ? Math.floor(maxViews) : null,
      viewCount: 0,
      sessionIds: [...new Set(sessionIds)],
      createdByDevice: String(createdByDevice || 'local').slice(0, 50),
      revoked: false
    };
    fs.writeFileSync(this.sharePath(shareId), JSON.stringify(record, null, 2), 'utf-8');
    return record;
  }

  get(shareId) {
    if (typeof shareId !== 'string' || !/^[A-Za-z0-9]{6,16}$/.test(shareId)) return null;
    const p = this.sharePath(shareId);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
  }

  validate(shareId, accessCode) {
    const record = this.get(shareId);
    if (!record) return { ok: false, reason: 'not_found' };
    if (record.revoked) return { ok: false, reason: 'revoked' };
    if (Date.now() > record.expiresAt) return { ok: false, reason: 'expired' };
    if (record.accessCodeHash) {
      const provided = crypto.createHash('sha256').update(String(accessCode || '')).digest('hex');
      if (provided !== record.accessCodeHash) return { ok: false, reason: 'access_code' };
    }
    return { ok: true, record };
  }

  // 记录一次访问；超过 maxViews 后返回 false
  recordView(shareId) {
    const record = this.get(shareId);
    if (!record) return false;
    if (record.maxViews && (record.viewCount || 0) >= record.maxViews) return false;
    record.viewCount = (record.viewCount || 0) + 1;
    fs.writeFileSync(this.sharePath(shareId), JSON.stringify(record, null, 2), 'utf-8');
    return true;
  }

  revoke(shareId) {
    const record = this.get(shareId);
    if (!record) return false;
    record.revoked = true;
    fs.writeFileSync(this.sharePath(shareId), JSON.stringify(record, null, 2), 'utf-8');
    return true;
  }

  list() {
    return fs.readdirSync(this.sharesDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(this.sharesDir, f), 'utf-8')); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}

export class CollectionManager {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'collections');
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  collectionPath(id) {
    return path.join(this.dir, `${id}.json`);
  }

  generateId() {
    let id = '';
    do {
      id = Array.from(crypto.randomBytes(7))
        .map(b => SHARE_ALPHABET[b % SHARE_ALPHABET.length])
        .join('');
    } while (fs.existsSync(this.collectionPath(id)));
    return id;
  }

  create({ name, sessionIds, description }, ownerId) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('会话集名称不能为空');
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) throw new Error('会话集必须包含至少一个会话');
    sessionIds.forEach(id => {
      if (typeof id !== 'string' || !id || path.basename(id) !== id) throw new Error('非法会话 ID');
    });
    const id = this.generateId();
    const record = {
      id,
      name: name.trim().slice(0, 80),
      description: String(description || '').slice(0, 200),
      sessionIds: [...new Set(sessionIds)],
      ownerId: ownerId || null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    fs.writeFileSync(this.collectionPath(id), JSON.stringify(record, null, 2), 'utf-8');
    return record;
  }

  get(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9]{6,16}$/.test(id)) return null;
    const p = this.collectionPath(id);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
  }

  update(id, { name, sessionIds, description }) {
    const record = this.get(id);
    if (!record) return null;
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) throw new Error('会话集名称不能为空');
      record.name = name.trim().slice(0, 80);
    }
    if (description !== undefined) record.description = String(description).slice(0, 200);
    if (sessionIds !== undefined) {
      if (!Array.isArray(sessionIds) || sessionIds.length === 0) throw new Error('会话集必须包含至少一个会话');
      record.sessionIds = [...new Set(sessionIds)];
    }
    record.updatedAt = Date.now();
    fs.writeFileSync(this.collectionPath(id), JSON.stringify(record, null, 2), 'utf-8');
    return record;
  }

  remove(id) {
    const record = this.get(id);
    if (!record) return false;
    fs.rmSync(this.collectionPath(id));
    return true;
  }

  list() {
    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8')); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
