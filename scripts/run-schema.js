import 'dotenv/config';
import { readFileSync } from 'fs';
import mysql from 'mysql2/promise';

const sql = readFileSync(new URL('../database.sql', import.meta.url), 'utf8');

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  multipleStatements: true,
});

try {
  await connection.query(sql);
  console.log('Schema applied successfully.');
} finally {
  await connection.end();
}
