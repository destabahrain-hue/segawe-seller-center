import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

let pool;
export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

export async function q(text, params = []) {
  const res = await getPool().query(text, params);
  return res.rows;
}

export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] || null;
}

let migrated = false;
export async function ensureSchema() {
  if (migrated) return;
  const sql = fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');
  await getPool().query(sql);
  migrated = true;
}

export async function log(kind, message, { shopId = null, ok = true } = {}) {
  try {
    await q('INSERT INTO activity_log (kind, shop_id, message, ok) VALUES ($1,$2,$3,$4)',
      [kind, shopId, String(message).slice(0, 900), ok]);
  } catch { /* log tidak boleh menjatuhkan proses utama */ }
}
