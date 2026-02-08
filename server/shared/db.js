import pg from 'pg';

// Handle CommonJS/ESM interop for 'pg'
const { Pool } = pg;

// In production, this comes from process.env.DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://telegram:secure_pass@localhost:5432/telegram_db',
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
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
    console.log('Database tables initialized');
  } catch (err) {
    console.error('Error initializing database', err);
  } finally {
    client.release();
  }
};

initDB();

export const query = (text, params) => pool.query(text, params);

export default pool;