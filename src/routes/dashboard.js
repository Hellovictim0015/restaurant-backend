import { Router } from 'express';
import { query } from '../lib/db.js';
import { success } from '../lib/response.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAdmin, async (_req, res) => {
  const [
    totalOrders,
    todayOrders,
    byStatus,
    revenue,
    todayRevenue,
    totalProducts,
    totalCategories,
    recentOrders,
  ] = await Promise.all([
    query('SELECT COUNT(*) AS count FROM orders'),
    query('SELECT COUNT(*) AS count FROM orders WHERE DATE(createdAt) = CURDATE()'),
    query('SELECT orderStatus, COUNT(*) AS count FROM orders GROUP BY orderStatus'),
    query("SELECT COALESCE(SUM(totalAmount), 0) AS total FROM orders WHERE paymentStatus = 'PAID'"),
    query(
      "SELECT COALESCE(SUM(totalAmount), 0) AS total FROM orders WHERE paymentStatus = 'PAID' AND DATE(createdAt) = CURDATE()"
    ),
    query('SELECT COUNT(*) AS count FROM products'),
    query('SELECT COUNT(*) AS count FROM categories'),
    query('SELECT * FROM orders ORDER BY createdAt DESC LIMIT 8'),
  ]);

  const statusCounts = {
    PENDING: 0,
    CONFIRMED: 0,
    PREPARING: 0,
    OUT_FOR_DELIVERY: 0,
    DELIVERED: 0,
    CANCELLED: 0,
  };
  for (const row of byStatus) {
    statusCounts[row.orderStatus] = row.count;
  }

  return success(
    res,
    {
      totalOrders: totalOrders[0].count,
      todayOrders: todayOrders[0].count,
      pendingOrders: statusCounts.PENDING,
      confirmedOrders: statusCounts.CONFIRMED,
      preparingOrders: statusCounts.PREPARING,
      outForDeliveryOrders: statusCounts.OUT_FOR_DELIVERY,
      deliveredOrders: statusCounts.DELIVERED,
      cancelledOrders: statusCounts.CANCELLED,
      totalRevenue: revenue[0].total,
      todayRevenue: todayRevenue[0].total,
      totalProducts: totalProducts[0].count,
      totalCategories: totalCategories[0].count,
      recentOrders,
    },
    'Dashboard stats fetched successfully'
  );
});

export default router;
