import pg from 'pg';

const { Pool } = pg;

// In production, this comes from process.env.DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://telegram:secure_pass@localhost:5432/telegram_db',
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export const query = (text, params) => pool.query(text, params);

export default pool;