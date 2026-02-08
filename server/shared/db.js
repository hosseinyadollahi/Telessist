import pg from 'pg';

// Handle CommonJS/ESM interop for 'pg'
const { Pool } = pg;

// In production, this comes from process.env.DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://telegram:secure_pass@localhost:5432/telegram_db',
});

pool.on('error', (err) => {
  console.error('[DB-FATAL] Unexpected error on idle client', err);
  process.exit(-1);
});

// Initialize Tables
const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) UNIQUE NOT NULL,
        username VARCHAR(50),
        avatar VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[DB-INIT] Database tables initialized successfully');
  } catch (err) {
    console.error('[DB-INIT-ERROR] Error initializing database', err);
  } finally {
    client.release();
  }
};

initDB();

// Wrapper for query logging
export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    
    // Log successful query
    console.log(`[DB] QUERY executed in ${duration}ms`, {
      text: text.replace(/\s+/g, ' ').trim(), // Remove excess whitespace for cleaner logs
      rows: res.rowCount
    });
    
    return res;
  } catch (err) {
    // Log error query
    const duration = Date.now() - start;
    console.error(`[DB] QUERY FAILED in ${duration}ms`, {
      text,
      params,
      error: err.message
    });
    throw err;
  }
};

export default pool;