import 'dotenv/config';
import app from './app.js';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set — copy .env.example to .env and fill it in.');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, () => {
  console.log(`Restaurant API listening on http://localhost:${PORT}`);
});
