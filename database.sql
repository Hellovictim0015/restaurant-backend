-- Restaurant Management System — MySQL schema
-- Run: mysql -u root -p < database.sql

CREATE DATABASE IF NOT EXISTS restaurant_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE restaurant_db;

-- ============================================================
-- admins
-- ============================================================
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================
-- categories
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) DEFAULT NULL,
  image VARCHAR(500) DEFAULT NULL,
  imagePublicId VARCHAR(255) DEFAULT NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  sortOrder INT NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_categories_status (status),
  INDEX idx_categories_sortOrder (sortOrder)
) ENGINE=InnoDB;

-- ============================================================
-- products
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  categoryId INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  description VARCHAR(1000) DEFAULT NULL,
  -- Nullable: a product either has a flat `price`, or has one or more rows in
  -- `product_variants` (e.g. "8 pcs — ₹100", "10 pcs — ₹150") and no flat price.
  price DECIMAL(10,2) DEFAULT NULL,
  image VARCHAR(500) DEFAULT NULL,
  imagePublicId VARCHAR(255) DEFAULT NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  isAvailable TINYINT(1) NOT NULL DEFAULT 1,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_category FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE RESTRICT,
  INDEX idx_products_category (categoryId),
  INDEX idx_products_status (status),
  INDEX idx_products_name (name)
) ENGINE=InnoDB;

-- ============================================================
-- product_variants — optional size/quantity options for a product, each with
-- its own price (e.g. Chicken: "8 pcs" ₹100, "10 pcs" ₹150). A product with
-- variants has no flat price — the customer must pick one to order.
-- ============================================================
CREATE TABLE IF NOT EXISTS product_variants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  productId INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  sortOrder INT NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_variants_product FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_variants_product (productId)
) ENGINE=InnoDB;

-- ============================================================
-- delivery_charge_tiers — admin-configurable distance slabs, e.g.
-- "up to 1 km -> ₹10", "up to 5 km -> ₹50", "up to 15 km -> ₹100". A distance
-- beyond every tier is capped at the last (highest upToKm) tier's charge.
-- Empty table = the old flat deliveryChargePerKm/freeDeliveryKm rule applies.
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_charge_tiers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  upToKm DECIMAL(6,2) NOT NULL,
  charge DECIMAL(10,2) NOT NULL,
  sortOrder INT NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================
-- restaurant_settings (single row, id = 1)
-- ============================================================
CREATE TABLE IF NOT EXISTS restaurant_settings (
  id INT PRIMARY KEY DEFAULT 1,
  name VARCHAR(150) NOT NULL DEFAULT 'My Restaurant',
  logo VARCHAR(500) DEFAULT NULL,
  logoPublicId VARCHAR(255) DEFAULT NULL,
  address VARCHAR(500) DEFAULT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  email VARCHAR(150) DEFAULT NULL,
  latitude DECIMAL(10,7) DEFAULT NULL,
  longitude DECIMAL(10,7) DEFAULT NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  minOrderAmount DECIMAL(10,2) NOT NULL DEFAULT 0,
  deliveryChargePerKm DECIMAL(10,2) NOT NULL DEFAULT 50,
  freeDeliveryKm DECIMAL(6,2) NOT NULL DEFAULT 0,
  -- NULL/0 = no limit. Beyond this distance, order placement is rejected outright.
  maxDeliveryKm DECIMAL(6,2) DEFAULT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_restaurant_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB;

INSERT INTO restaurant_settings (id, name, address, phone, email, latitude, longitude, status, minOrderAmount, deliveryChargePerKm, freeDeliveryKm)
VALUES (1, 'My Restaurant', 'Raipur, Chhattisgarh', '9999999999', 'restaurant@example.com', 21.2514000, 81.6296000, 1, 0, 50, 0)
ON DUPLICATE KEY UPDATE id = id;

-- ============================================================
-- customers — email + OTP based accounts for the Flutter app (optional login;
-- guest checkout without an account is still supported).
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) DEFAULT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  points INT NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================
-- email_otps — short-lived one-time codes for email login.
-- ============================================================
CREATE TABLE IF NOT EXISTS email_otps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(150) NOT NULL,
  codeHash VARCHAR(255) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed TINYINT(1) NOT NULL DEFAULT 0,
  expiresAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_otps_email (email),
  INDEX idx_email_otps_expiresAt (expiresAt)
) ENGINE=InnoDB;

-- ============================================================
-- pending_orders — a checkout draft that only graduates into a real `orders`
-- row once Razorpay payment is verified. Keeps the orders table free of
-- abandoned-checkout clutter (never-paid carts never appear to the admin).
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  razorpayOrderId VARCHAR(100) DEFAULT NULL UNIQUE,
  orderType ENUM('DELIVERY','DINE_IN') NOT NULL DEFAULT 'DELIVERY',
  tableNumber VARCHAR(20) DEFAULT NULL,
  customerId INT DEFAULT NULL,
  customerName VARCHAR(150) NOT NULL,
  customerPhone VARCHAR(20) NOT NULL,
  customerEmail VARCHAR(150) DEFAULT NULL,
  customerAddress VARCHAR(500) NOT NULL,
  customerLatitude DECIMAL(10,7) NOT NULL,
  customerLongitude DECIMAL(10,7) NOT NULL,
  distanceKm DECIMAL(6,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  deliveryCharge DECIMAL(10,2) NOT NULL DEFAULT 0,
  couponCode VARCHAR(50) DEFAULT NULL,
  couponDiscount DECIMAL(10,2) NOT NULL DEFAULT 0,
  pointsRedeemed INT NOT NULL DEFAULT 0,
  pointsDiscount DECIMAL(10,2) NOT NULL DEFAULT 0,
  totalAmount DECIMAL(10,2) NOT NULL DEFAULT 0,
  itemsJson JSON NOT NULL,
  notes VARCHAR(500) DEFAULT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pending_orders_razorpay (razorpayOrderId),
  INDEX idx_pending_orders_createdAt (createdAt)
) ENGINE=InnoDB;

-- ============================================================
-- orders
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orderNumber VARCHAR(30) NOT NULL UNIQUE,
  orderType ENUM('DELIVERY','DINE_IN') NOT NULL DEFAULT 'DELIVERY',
  tableNumber VARCHAR(20) DEFAULT NULL,
  customerId INT DEFAULT NULL,
  customerName VARCHAR(150) NOT NULL,
  customerPhone VARCHAR(20) NOT NULL,
  customerEmail VARCHAR(150) DEFAULT NULL,
  customerAddress VARCHAR(500) NOT NULL,
  customerLatitude DECIMAL(10,7) NOT NULL,
  customerLongitude DECIMAL(10,7) NOT NULL,
  distanceKm DECIMAL(6,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  deliveryCharge DECIMAL(10,2) NOT NULL DEFAULT 0,
  couponCode VARCHAR(50) DEFAULT NULL,
  couponDiscount DECIMAL(10,2) NOT NULL DEFAULT 0,
  pointsRedeemed INT NOT NULL DEFAULT 0,
  pointsDiscount DECIMAL(10,2) NOT NULL DEFAULT 0,
  totalAmount DECIMAL(10,2) NOT NULL DEFAULT 0,
  orderStatus ENUM('PENDING','CONFIRMED','PREPARING','OUT_FOR_DELIVERY','DELIVERED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  paymentStatus ENUM('PENDING','PAID','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  paymentMethod VARCHAR(20) NOT NULL DEFAULT 'RAZORPAY',
  pointsEarned INT NOT NULL DEFAULT 0,
  notes VARCHAR(500) DEFAULT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE SET NULL,
  INDEX idx_orders_status (orderStatus),
  INDEX idx_orders_payment_status (paymentStatus),
  INDEX idx_orders_createdAt (createdAt),
  INDEX idx_orders_phone (customerPhone),
  INDEX idx_orders_customer (customerId)
) ENGINE=InnoDB;

-- ============================================================
-- order_items
-- ============================================================
CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orderId INT NOT NULL,
  productId INT NOT NULL,
  productName VARCHAR(150) NOT NULL,
  variantId INT DEFAULT NULL,
  variantName VARCHAR(100) DEFAULT NULL,
  price DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL,
  itemTotal DECIMAL(10,2) NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_items_order FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (productId) REFERENCES products(id) ON DELETE RESTRICT,
  INDEX idx_order_items_order (orderId),
  INDEX idx_order_items_product (productId)
) ENGINE=InnoDB;

-- ============================================================
-- payments
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orderId INT NOT NULL,
  razorpayOrderId VARCHAR(100) DEFAULT NULL,
  razorpayPaymentId VARCHAR(100) DEFAULT NULL,
  razorpaySignature VARCHAR(255) DEFAULT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  status ENUM('PENDING','PAID','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  failureReason VARCHAR(500) DEFAULT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_order FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_payments_order (orderId),
  INDEX idx_payments_razorpay_order (razorpayOrderId)
) ENGINE=InnoDB;

-- ============================================================
-- coupons — admin-created promo codes shown to customers in the app and
-- applied at checkout.
-- ============================================================
CREATE TABLE IF NOT EXISTS coupons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255) DEFAULT NULL,
  discountType ENUM('FLAT','PERCENTAGE') NOT NULL DEFAULT 'FLAT',
  discountValue DECIMAL(10,2) NOT NULL,
  maxDiscount DECIMAL(10,2) DEFAULT NULL,
  minOrderAmount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status TINYINT(1) NOT NULL DEFAULT 1,
  expiresAt TIMESTAMP NULL DEFAULT NULL,
  timesUsed INT NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_coupons_status (status)
) ENGINE=InnoDB;
