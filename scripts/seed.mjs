#!/usr/bin/env node
// Loads the demo data (supabase/seed.sql), then runs, approves, sends and pays the first royalty
// period's statements so the demo has a history. A second run does nothing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { execute } from './royalties.mjs';

export async function seed(db) {
  await db.exec('BEGIN');
  try {
    await db.exec(readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8'));
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
  if ((await db.query('select count(*)::int as n from statements'))[0].n) return;
  const [d] = await db.query(`select (ends_on + 60)::text as sent, (ends_on + 65)::text as paid from royalty_periods where ref = 'S1'`);
  await execute(db, ['run-statements', 'S1']);
  await execute(db, ['approve', 'S1']);
  await execute(db, ['mark-sent', 'S1', `--date=${d.sent}`]);
  await execute(db, ['mark-paid', 'S1', `--date=${d.paid}`]);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    if (db.mode === 'postgres' && !process.argv.includes('--demo-database')) {
      throw new Error('Shared database seed requires --demo-database. Use only an empty disposable demo database.');
    }
    await seed(db);
    console.log(`seed: demo data ready (${db.mode})`);
  } finally {
    await db.close();
  }
}
