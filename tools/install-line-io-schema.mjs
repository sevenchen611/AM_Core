import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { lineIoDatabaseConfig } from '../core/line-io/database.js';

const pool = new Pool({ ...lineIoDatabaseConfig(process.env), max: 1, connectionTimeoutMillis: 10000 });
try {
  await pool.query(await readFile(new URL('../versions/AM-IMP-2026.0929.01/schemas/line-io.sql', import.meta.url), 'utf8'));
  console.log('LINE I/O additive schema installed. No existing business tables changed.');
} finally { await pool.end(); }
