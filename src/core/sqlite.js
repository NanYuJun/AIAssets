import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/**
 * SQLite 查询（使用 Node 22+ 内置的 node:sqlite，无 Python 依赖）。
 */
export function querySqlite(dbPath, sql, params = []) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found: ${dbPath}`);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map(row => ({ ...row }));
  } finally {
    db.close();
  }
}

/**
 * 可写 SQLite 执行（INSERT/UPDATE/DELETE），无 Python 依赖。
 */
export function execSqlite(dbPath, sql, params = []) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found: ${dbPath}`);
  }

  const db = new DatabaseSync(dbPath);
  try {
    const stmt = db.prepare(sql);
    const result = stmt.run(...params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  } finally {
    db.close();
  }
}
