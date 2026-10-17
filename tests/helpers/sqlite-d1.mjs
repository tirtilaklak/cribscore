import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Real SQLite executes the production D1 statements; only the async D1 envelope is emulated.
export class SQLiteD1 {
  constructor({ migrate = true } = {}) {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    this.calls = [];
    this.batchCount = 0;
    if (migrate) for (const file of readdirSync(new URL('../../drizzle/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) {
      this.sqlite.exec(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), 'utf8'));
    }
  }
  withSession(constraint) { this.calls.push({ session: constraint }); return this; }
  prepare(sql) {
    const self = this;
    return {
      sql, values: [],
      bind(...values) { this.values = values; return this; },
      async all() { self.calls.push({ sql, read: true }); return { success: true, results: self.sqlite.prepare(sql).all(...this.values) }; },
    };
  }
  async batch(statements) {
    this.batchCount++;
    if (this.beforeBatch) { const callback = this.beforeBatch; this.beforeBatch = null; await callback(); }
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = statements.map((statement, index) => {
        this.calls.push({ sql: statement.sql, write: true, maxBindingBytes: Math.max(0, ...statement.values.filter(v => typeof v === 'string').map(v => Buffer.byteLength(v))) });
        if (index === this.failAt) throw new Error('synthetic atomic failure; owner-private SQL must not leak');
        const meta = this.sqlite.prepare(statement.sql).run(...statement.values);
        return { success: true, meta: { changes: Number(meta.changes) } };
      });
      this.sqlite.exec('COMMIT');
      if (this.afterBatch) { const callback = this.afterBatch; this.afterBatch = null; await callback(); }
      return result;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  close() { this.sqlite.close(); }
}
