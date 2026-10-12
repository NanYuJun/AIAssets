import fs from 'node:fs';
import path from 'node:path';

const MAX_LOG = 200;

export class RequestLog {
  constructor(dataDir) {
    this.logPath = path.join(dataDir, 'request-log.json');
  }

  load() {
    try { return JSON.parse(fs.readFileSync(this.logPath, 'utf-8')); } catch { return [] }
  }

  add(entry) {
    const logs = this.load();
    logs.unshift({ ts: Date.now(), ...entry });
    fs.writeFileSync(this.logPath, JSON.stringify(logs.slice(0, MAX_LOG), null, 2), 'utf-8');
  }

  list(limit = 50) {
    return this.load().slice(0, limit);
  }
}
