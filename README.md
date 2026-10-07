# Restaurant API (Node.js + Express)

REST API for the Restaurant Management System — serves the Next.js admin panel (`restaurant-web`) and the customer Flutter app. MySQL, Cloudinary (images), Razorpay (payments), Gmail SMTP (customer OTP login).

## Setup

```bash
npm install
cp .env.example .env      # fill in real values
npm run db:schema         # create database + tables (first time only)
npm run db:seed-admin -- you@example.com "YourPassword123" "Your Name"
npm run dev               # http://localhost:5000 (auto-restarts on file changes)
```

`npm start` runs without watch mode (production).

**`JWT_SECRET` must be identical in this `.env` and in `restaurant-web/.env.local`** — the backend signs the admin cookie, Next.js verifies it to guard `/admin` pages.

## How the admin panel talks to this API

`restaurant-web/next.config.mjs` rewrites every `/api/*` request to `BACKEND_URL/api/*`. The browser only ever talks to the Next.js domain, so the `admin_token` httpOnly cookie stays same-origin and no CORS config is required. The Flutter app can call this server directly (or keep using the Next.js domain — both work).

## Structure

```
src/
  server.js        loads .env, starts the server
  app.js           express app, middleware, route mounting, error handler
  lib/             db, auth, pricing (orderCalc), coupons, points, razorpay, cloudinary, mailer...
  middleware/      requireAdmin (cookie), requireJsonBody
  routes/          one file per /api/<resource>
scripts/           run-schema.js, seed-admin.js
database.sql       full schema
```

## API

All responses: `{ success, message, data }` (paginated lists add `pagination`). Admin routes need the `admin_token` cookie from `POST /api/auth/login`; customer routes use `Authorization: Bearer <token>` from the OTP flow.

| Route | Methods | Auth |
|---|---|---|
| `/api/auth/login`, `/logout`, `/me` | POST, POST, GET | public |
| `/api/categories`, `/api/categories/:id` | GET / POST, PUT, DELETE | GET public, rest admin |
| `/api/products`, `/api/products/:id` | GET / POST, PUT, DELETE | GET public, rest admin. Filters: `categoryId`, `search`, `status`, `available=1`, `page`, `limit` |
| `/api/coupons`, `/api/coupons/:id` | GET / POST, PUT, DELETE | GET public, rest admin |
| `/api/restaurant` | GET / PUT | GET public, PUT admin |
| `/api/delivery-tiers` | GET, PUT | admin |
| `/api/dashboard` | GET | admin |
| `/api/upload` | POST (multipart `file`, `folder`) | admin |
| `/api/orders` | GET | admin, or public with `?phone=` |
| `/api/orders` | POST | public (optional customer bearer) |
| `/api/orders/calculate` | POST | public |
| `/api/orders/:id` | GET (id or orderNumber) | public |
| `/api/orders/:id/status` | PUT | admin |
| `/api/payment/create-order`, `/api/payment/verify` | POST | public |
| `/api/distance` | POST | public |
| `/api/customer/auth/request-otp`, `/verify-otp` | POST | public |
| `/api/customer/me` | GET, PUT | customer bearer |
| `/health` | GET | public |
