import mysql from 'mysql2/promise';

function typeCast(field, next) {
  if (field.type === 'TINY' && field.length === 1) {
    const value = field.string();
    return value === null ? null : value === '1';
  }
  return next();
}

function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'restaurant_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    decimalNumbers: true,
    typeCast,
    // Tell mysql2 that DATETIME/TIMESTAMP values coming back from the server
    // are UTC (the default for both local MySQL and AWS RDS unless someone
    // changed it) — without this, the driver assumes they're already in the
    // Node process's local timezone and silently shifts every Date object by
    // the difference, which breaks anything comparing a DB timestamp against
    // `Date.now()` (e.g. OTP expiry) whenever the app server's system
    // timezone isn't UTC too.
    timezone: 'Z',
  });
}

const pool = createPool();

// mysql2 pool.execute() (binary prepared-statement protocol) rejects LIMIT/OFFSET
// placeholders on some server versions. pool.query() still escapes `?` client-side
// (injection-safe) but avoids that failure — use it for all app queries.
export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Runs `fn` inside a single transactional connection. `fn` receives a `query`
// function scoped to that connection — use it instead of the pool-level `query`
// for every statement inside the callback so they share the same transaction.
export async function withTransaction(fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const scopedQuery = async (sql, params = []) => {
      const [rows] = await connection.query(sql, params);
      return rows;
    };
    const result = await fn(scopedQuery);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export default pool;
