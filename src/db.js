// Capa de datos. DATABASE_URL definido → Postgres (persistente). Si no → data.json local (prototipo).
// El modelo en memoria es el mismo; save() persiste los cambios.
// Postgres: tabla records(collection, id, data JSONB) para proyectos/pagos/suscripciones/descargas
// y tabla files(name, data BYTEA) para los PDF y las vistas previas (se restauran a disco al arrancar).
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', 'data.json');
const FILES = path.join(__dirname, '..', 'files');
const COLLECTIONS = ['projects', 'payments', 'subscriptions', 'downloads'];
const db = { projects: [], payments: [], subscriptions: [], downloads: [] };
let pool = null, timer = null, pending = Promise.resolve();
// Protección: una base de Neon (producción) solo se usa si NODE_ENV=production (Render) o ALLOW_PROD_DB=1.
// Así las pruebas locales nunca escriben en producción aunque DATABASE_URL esté en el entorno.
if (process.env.DATABASE_URL && /neon\.tech/.test(process.env.DATABASE_URL) && process.env.NODE_ENV !== 'production' && process.env.ALLOW_PROD_DB !== '1') {
  console.warn('DATABASE_URL de Neon ignorada fuera de producción (usa ALLOW_PROD_DB=1 para forzarla). Usando data.json local.');
  delete process.env.DATABASE_URL;
}
const backend = process.env.DATABASE_URL ? 'postgres' : 'json';

async function init() {
  if (backend === 'json') { if (fs.existsSync(FILE)) Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8'))); return; }
  const url = process.env.DATABASE_URL;
  if (/neon\.tech/.test(url)) {
    // Neon: driver serverless compatible con pg, vía WebSocket (443, TLS). Funciona aunque el puerto 5432 esté bloqueado.
    const { Pool, neonConfig } = require('@neondatabase/serverless');
    neonConfig.webSocketConstructor = require('ws');
    pool = new Pool({ connectionString: url, max: 3 });
  } else {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 3 });
  }
  pool.on('error', e => console.error('db pool:', e.message)); // conexiones inactivas que Neon cierra no deben tumbar el servidor
  await pool.query(`CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (collection, id));
                    CREATE TABLE IF NOT EXISTS files (name TEXT PRIMARY KEY, data BYTEA NOT NULL, created_at TIMESTAMPTZ DEFAULT now());`);
  const { rows } = await pool.query('SELECT collection, data FROM records ORDER BY (data->>\'created_at\') NULLS FIRST');
  for (const c of COLLECTIONS) db[c] = rows.filter(r => r.collection === c).map(r => r.data);
  fs.mkdirSync(FILES, { recursive: true });
  const f = await pool.query('SELECT name, data FROM files');
  for (const r of f.rows) { const p = path.join(FILES, path.basename(r.name)); if (!fs.existsSync(p)) fs.writeFileSync(p, r.data); }
}
const keyOf = (c, x) => String(x.id || x.token);
async function flushOnce() {
  const client = await pool.connect();
  const onErr = e => console.error('db client:', e.message);
  client.on('error', onErr); // una conexión cortada a mitad de camino no debe tumbar el servidor
  let failed;
  try {
    await client.query('BEGIN');
    for (const c of COLLECTIONS) for (const x of db[c] || [])
      await client.query('INSERT INTO records (collection,id,data) VALUES ($1,$2,$3) ON CONFLICT (collection,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now() WHERE records.data IS DISTINCT FROM EXCLUDED.data', [c, keyOf(c, x), x]);
    await client.query('COMMIT');
  } catch (e) { failed = e; await client.query('ROLLBACK').catch(() => {}); }
  finally { client.removeListener('error', onErr); client.release(failed); }
  if (failed) throw failed;
}
async function flush() {
  if (backend === 'json') return fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
  for (let i = 1; i <= 3; i++) {
    try { return await flushOnce(); }
    catch (e) { console.error(`db flush intento ${i}:`, e.message); await new Promise(r => setTimeout(r, 300 * i)); }
  }
}
// Guardado: JSON inmediato; Postgres agrupado cada 300 ms en serie.
function save() {
  if (backend === 'json') return flush();
  clearTimeout(timer); timer = setTimeout(() => { pending = pending.then(flush); }, 300);
}
async function saveNow() { clearTimeout(timer); pending = pending.then(flush); return pending; }
async function putFile(name, buf) { if (pool) for (let i = 1; i <= 3; i++) { try { return await pool.query('INSERT INTO files (name,data) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET data=EXCLUDED.data', [name, buf]); } catch (e) { if (i === 3) throw e; await new Promise(r => setTimeout(r, 300 * i)); } } }
async function close() { await saveNow(); if (pool) await pool.end(); }
module.exports = { db, save, saveNow, init, putFile, close, backend };
