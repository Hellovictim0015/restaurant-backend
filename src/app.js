import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';

import { failure } from './lib/response.js';
import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';
import productRoutes from './routes/products.js';
import couponRoutes from './routes/coupons.js';
import customerRoutes from './routes/customer.js';
import dashboardRoutes from './routes/dashboard.js';
import deliveryTierRoutes from './routes/deliveryTiers.js';
import distanceRoutes from './routes/distance.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payment.js';
import restaurantRoutes from './routes/restaurant.js';
import uploadRoutes from './routes/upload.js';

const app = express();

app.set('trust proxy', 1);

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    // Requests without an Origin header (Flutter app, curl, Next.js server-side
    // fetches and its /api rewrite) are always allowed.
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ success: true, message: 'OK' }));

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/delivery-tiers', deliveryTierRoutes);
app.use('/api/distance', distanceRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/restaurant', restaurantRoutes);
app.use('/api/upload', uploadRoutes);

app.use((_req, res) => failure(res, 'Route not found', 404));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return failure(res, 'Invalid request body', 400);
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be smaller than 5MB' : err.message;
    return failure(res, message, 400);
  }
  console.error('Unhandled error:', err);
  return failure(res, 'Something went wrong', 500);
});

export default app;
