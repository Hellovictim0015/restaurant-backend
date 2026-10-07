import 'dotenv/config';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const email = process.argv[2] || 'admin@restaurant.com';
const password = process.argv[3] || 'Admin@123';
const name = process.argv[4] || 'Restaurant Admin';

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'restaurant_db',
});

try {
  const hash = await bcrypt.hash(password, 10);
  await connection.query(
    'INSERT INTO admins (name, email, password) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password = VALUES(password), name = VALUES(name)',
    [name, email.trim().toLowerCase(), hash]
  );
  console.log(`Admin ready -> email: ${email}`);
} finally {
  await connection.end();
}
