-- ============================================================================
-- FINAL COMPLETE migration — SAFE version with IF conditions.
-- Every column/table addition checks first whether it already exists, so
-- this file can be run multiple times without ever erroring out.
--
-- Note: uses DELIMITER — if your GUI tool (phpMyAdmin/Adminer/etc.) doesn't
-- support DELIMITER blocks, run this via the `mysql` command-line client
-- instead: mysql -u USER -p DBNAME < migration_final_complete_safe.sql
-- ============================================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS _add_column_if_missing$$
CREATE PROCEDURE _add_column_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition VARCHAR(255)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_column, ' ', p_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS _add_fk_if_missing$$
CREATE PROCEDURE _add_fk_if_missing(
  IN p_table VARCHAR(64),
  IN p_constraint VARCHAR(64),
  IN p_definition VARCHAR(255)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND CONSTRAINT_NAME = p_constraint
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE ', p_table, ' ADD CONSTRAINT ', p_constraint, ' ', p_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

-- ----------------------------------------------------------------------------
-- 1. restaurant_settings
-- ----------------------------------------------------------------------------
CALL _add_column_if_missing('restaurant_settings', 'deliveryChargePerKm', 'DECIMAL(10,2) NOT NULL DEFAULT 50 AFTER minOrderAmount');
CALL _add_column_if_missing('restaurant_settings', 'freeDeliveryKm', 'DECIMAL(6,2) NOT NULL DEFAULT 0 AFTER deliveryChargePerKm');
CALL _add_column_if_missing('restaurant_settings', 'maxDeliveryKm', 'DECIMAL(6,2) DEFAULT NULL AFTER freeDeliveryKm');

-- ----------------------------------------------------------------------------
-- 2. pending_orders
-- ----------------------------------------------------------------------------
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
  totalAmount DECIMAL(10,2) NOT NULL DEFAULT 0,
  itemsJson JSON NOT NULL,
  notes VARCHAR(500) DEFAULT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pending_orders_razorpay (razorpayOrderId),
  INDEX idx_pending_orders_createdAt (createdAt)
) ENGINE=InnoDB;

CALL _add_column_if_missing('pending_orders', 'orderType', "ENUM('DELIVERY','DINE_IN') NOT NULL DEFAULT 'DELIVERY' AFTER razorpayOrderId");
CALL _add_column_if_missing('pending_orders', 'tableNumber', 'VARCHAR(20) DEFAULT NULL AFTER orderType');
CALL _add_column_if_missing('pending_orders', 'customerId', 'INT DEFAULT NULL AFTER tableNumber');

-- ----------------------------------------------------------------------------
-- 3. customers + email_otps
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) DEFAULT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  points INT NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

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

-- ----------------------------------------------------------------------------
-- 4. orders
-- ----------------------------------------------------------------------------
CALL _add_column_if_missing('orders', 'orderType', "ENUM('DELIVERY','DINE_IN') NOT NULL DEFAULT 'DELIVERY' AFTER orderNumber");
CALL _add_column_if_missing('orders', 'tableNumber', 'VARCHAR(20) DEFAULT NULL AFTER orderType');
CALL _add_column_if_missing('orders', 'customerId', 'INT DEFAULT NULL AFTER tableNumber');
CALL _add_column_if_missing('orders', 'pointsEarned', 'INT NOT NULL DEFAULT 0 AFTER paymentMethod');

CALL _add_fk_if_missing('orders', 'fk_orders_customer', 'FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE SET NULL');

-- ----------------------------------------------------------------------------
-- 5. product_variants + products.price nullable
-- ----------------------------------------------------------------------------
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

-- MODIFY COLUMN is always safe to re-run (not additive), no IF check needed.
ALTER TABLE products MODIFY COLUMN price DECIMAL(10,2) DEFAULT NULL;

CALL _add_column_if_missing('order_items', 'variantId', 'INT DEFAULT NULL AFTER productName');
CALL _add_column_if_missing('order_items', 'variantName', 'VARCHAR(100) DEFAULT NULL AFTER variantId');

-- ----------------------------------------------------------------------------
-- 6. delivery_charge_tiers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delivery_charge_tiers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  upToKm DECIMAL(6,2) NOT NULL,
  charge DECIMAL(10,2) NOT NULL,
  sortOrder INT NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- 7. coupons + pending_orders/orders coupon & points-redemption columns
-- ----------------------------------------------------------------------------
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

CALL _add_column_if_missing('pending_orders', 'couponCode', 'VARCHAR(50) DEFAULT NULL AFTER deliveryCharge');
CALL _add_column_if_missing('pending_orders', 'couponDiscount', 'DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER couponCode');
CALL _add_column_if_missing('pending_orders', 'pointsRedeemed', 'INT NOT NULL DEFAULT 0 AFTER couponDiscount');
CALL _add_column_if_missing('pending_orders', 'pointsDiscount', 'DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER pointsRedeemed');

CALL _add_column_if_missing('orders', 'couponCode', 'VARCHAR(50) DEFAULT NULL AFTER deliveryCharge');
CALL _add_column_if_missing('orders', 'couponDiscount', 'DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER couponCode');
CALL _add_column_if_missing('orders', 'pointsRedeemed', 'INT NOT NULL DEFAULT 0 AFTER couponDiscount');
CALL _add_column_if_missing('orders', 'pointsDiscount', 'DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER pointsRedeemed');

-- ----------------------------------------------------------------------------
-- Cleanup — drop the helper procedures, they were only needed for this run.
-- ----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _add_column_if_missing;
DROP PROCEDURE IF EXISTS _add_fk_if_missing;
