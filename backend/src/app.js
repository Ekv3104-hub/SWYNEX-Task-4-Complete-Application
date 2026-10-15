const express = require('express');
const crypto = require('node:crypto');
const { DEFAULT_CANTEEN_ID, uuid } = require('./db/database');
const { apiError, decodeJwtForConfiguredMode, requireAuth, requireCanteenMember, requireRole } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const ORDER_STATUSES = ['order_placed', 'preparing', 'ready_for_pickup', 'completed'];
const PAYMENT_METHODS = ['upi', 'card', 'cash'];

function centsToRupees(value) {
  return Math.round(Number(value || 0) / 100);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function orderResponse(order, items = []) {
  return {
    id: order.id,
    token: order.token,
    canteenId: order.canteen_id,
    userId: order.customer_id,
    customerId: order.customer_id,
    customerName: order.customer_name,
    phone: order.phone,
    pickupSpot: order.pickup_spot,
    pickupTime: order.pickup_time,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    subtotal: centsToRupees(order.subtotal_cents),
    tax: centsToRupees(order.tax_cents),
    discount: centsToRupees(order.discount_cents),
    total: centsToRupees(order.total_cents),
    status: order.status,
    notes: order.notes,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: items.map((item) => ({
      id: item.id,
      menuItemId: item.menu_item_id,
      name: item.name_snapshot,
      unitPrice: centsToRupees(item.price_snapshot_cents),
      quantity: item.quantity,
      lineTotal: centsToRupees(item.line_total_cents)
    }))
  };
}

function menuResponse(item) {
  return {
    id: item.id,
    canteenId: item.canteen_id,
    categoryId: item.category_id,
    name: item.name,
    desc: item.description,
    description: item.description,
    category: item.category,
    price: centsToRupees(item.price_cents),
    image: item.image_url,
    imageUrl: item.image_url,
    isAvailable: Boolean(item.is_available && item.is_active && Number(item.stock_quantity || 0) > 0),
    isActive: Boolean(item.is_active),
    stockQuantity: Number(item.stock_quantity || 0),
    lowStockThreshold: Number(item.low_stock_threshold || 0),
    badge: parseJson(item.tags, [])[0] || ''
  };
}

function validateString(body, field, details, label = field) {
  if (typeof body[field] !== 'string' || body[field].trim() === '') {
    details.push({ field, message: `${label} is required.` });
    return '';
  }
  return body[field].trim();
}

function validateOrderPayload(body) {
  const details = [];
  const customerName = validateString(body, 'customerName', details, 'customer name');
  const phone = validateString(body, 'phone', details, 'phone');
  const pickupSpot = validateString(body, 'pickupSpot', details, 'pickup spot');
  const pickupTime = validateString(body, 'pickupTime', details, 'pickup time');
  const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.toLowerCase() : '';

  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    details.push({ field: 'paymentMethod', message: `payment method must be one of: ${PAYMENT_METHODS.join(', ')}.` });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    details.push({ field: 'items', message: 'at least one item is required.' });
  } else {
    body.items.forEach((item, index) => {
      if (!item || typeof item.menuItemId !== 'string' || item.menuItemId.trim() === '') {
        details.push({ field: `items[${index}].menuItemId`, message: 'menuItemId is required.' });
      }
      if (!item || !Number.isInteger(item.quantity) || item.quantity <= 0) {
        details.push({ field: `items[${index}].quantity`, message: 'quantity must be a positive integer.' });
      }
    });
  }

  if (details.length) throw apiError(400, 'VALIDATION_ERROR', 'Request validation failed.', details);
  return { customerName, phone: phone.replace(/[\s-]/g, ''), pickupSpot, pickupTime, paymentMethod };
}

async function getOrder(db, id) {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [Number(id)]);
  if (!order) return null;
  const items = await db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [order.id]);
  return orderResponse(order, items);
}

async function createOrder(db, body, user) {
  const validated = validateOrderPayload(body);
  const canteenId = body.canteenId || DEFAULT_CANTEEN_ID;

  return db.withTransaction(async (tx) => {
    const ids = [...new Set(body.items.map((item) => item.menuItemId))];
    const menuItems = await Promise.all(ids.map((id) => tx.get(
      `SELECT menu_items.*, inventory.stock_quantity, inventory.low_stock_threshold
       FROM menu_items LEFT JOIN inventory ON inventory.menu_item_id = menu_items.id
       WHERE menu_items.id = ? AND menu_items.canteen_id = ? AND menu_items.is_active = 1`,
      [id, canteenId]
    )));
    const byId = new Map(menuItems.filter(Boolean).map((item) => [item.id, item]));
    const details = [];

    for (const item of body.items) {
      const menuItem = byId.get(item.menuItemId);
      if (!menuItem) {
        details.push({ field: 'menuItemId', value: item.menuItemId, message: 'menu item was not found.' });
      } else if (!menuItem.is_available) {
        details.push({ field: 'menuItemId', value: item.menuItemId, message: 'menu item is not available.' });
      } else if (Number(menuItem.stock_quantity || 0) < item.quantity) {
        details.push({ field: 'quantity', value: item.quantity, message: `${menuItem.name} has only ${menuItem.stock_quantity} in stock.` });
      }
    }
    if (details.length) throw apiError(400, 'VALIDATION_ERROR', 'Request validation failed.', details);

    const enriched = body.items.map((item) => {
      const menuItem = byId.get(item.menuItemId);
      return {
        ...item,
        nameSnapshot: menuItem.name,
        priceSnapshotCents: menuItem.price_cents,
        lineTotalCents: menuItem.price_cents * item.quantity
      };
    });
    const subtotalCents = enriched.reduce((sum, item) => sum + item.lineTotalCents, 0);
    const taxCents = Math.round(subtotalCents * 0.05);
    const discountCents = 0;
    const totalCents = subtotalCents + taxCents - discountCents;
    const paymentStatus = validated.paymentMethod === 'cash' ? 'unpaid' : 'pending';

    const result = await tx.run(
      `INSERT INTO orders
       (canteen_id, customer_id, customer_name, phone, pickup_spot, pickup_time, payment_method, payment_status, subtotal_cents, tax_cents, discount_cents, total_cents, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [canteenId, user?.id || null, validated.customerName, validated.phone, validated.pickupSpot, validated.pickupTime, validated.paymentMethod, paymentStatus, subtotalCents, taxCents, discountCents, totalCents, body.notes || null]
    );
    const orderId = result.lastID;
    const token = `#FQ-${String(orderId).padStart(4, '0')}`;
    await tx.run('UPDATE orders SET token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [token, orderId]);

    for (const item of enriched) {
      await tx.run(
        `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, price_snapshot_cents, quantity, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, item.menuItemId, item.nameSnapshot, item.priceSnapshotCents, item.quantity, item.lineTotalCents]
      );
      const invUpdate = await tx.run(
        'UPDATE inventory SET stock_quantity = stock_quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE menu_item_id = ? AND stock_quantity >= ?',
        [item.quantity, item.menuItemId, item.quantity]
      );
      if (invUpdate.changes === 0) {
        throw apiError(400, 'INSUFFICIENT_STOCK', `Insufficient stock for ${item.nameSnapshot}.`);
      }
      await tx.run(
        'INSERT INTO inventory_movements (menu_item_id, change_quantity, reason, created_by) VALUES (?, ?, ?, ?)',
        [item.menuItemId, -item.quantity, `Order ${token}`, user?.id || null]
      );
    }
    await tx.run('INSERT INTO order_status_history (order_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?)', [orderId, null, 'order_placed', user?.id || null]);
    return getOrder(tx, orderId);
  });
}

async function loadOwnerCanteen(db, user) {
  const membership = await db.get(
    'SELECT canteen_id FROM canteen_members WHERE profile_id = ? ORDER BY created_at LIMIT 1',
    [user.id]
  );
  if (!membership) throw apiError(403, 'FORBIDDEN', 'No canteen is assigned to this owner account.');
  return membership.canteen_id;
}

function createApp(db) {
  const app = express();
  const auth = requireAuth(db);

  app.use((req, res, next) => {
    const origin = req.header('origin');
    const isProduction = process.env.NODE_ENV === 'production';
    const rawOrigins = process.env.CORS_ORIGINS || (isProduction ? '' : 'http://127.0.0.1:8080,http://localhost:8080,http://127.0.0.1:3000,http://localhost:3000');
    const allowedOrigins = rawOrigins.split(',').map((o) => o.trim()).filter(Boolean);

    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-test-profile-id,x-owner-bootstrap-secret');

    if (origin) {
      const isAllowed = allowedOrigins.includes(origin) || (!isProduction && allowedOrigins.includes('*'));
      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      } else if (req.method === 'OPTIONS') {
        return res.status(403).json({ error: { code: 'CORS_FORBIDDEN', message: 'Origin not allowed by CORS policy.' } });
      }
    } else if (!isProduction && allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, database: db.kind }));

  app.post('/api/auth/profile', async (req, res, next) => {
    try {
      const header = req.header('authorization') || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) throw apiError(401, 'UNAUTHENTICATED', 'Authentication is required.');
      const payload = await decodeJwtForConfiguredMode(token);
      const authUserId = payload.sub || payload.user_id;
      const email = payload.email || req.body.email;
      const existing = await db.get('SELECT * FROM profiles WHERE auth_user_id = ?', [authUserId]);
      if (existing) return res.json({ profile: existing });
      const role = 'customer';
      const id = uuid();
      await db.run(
        'INSERT INTO profiles (id, auth_user_id, name, email, phone, role) VALUES (?, ?, ?, ?, ?, ?)',
        [id, authUserId, req.body.name || email || 'FoodQueue Customer', email || null, req.body.phone || null, role]
      );
      await db.run('INSERT OR IGNORE INTO user_preferences (profile_id) VALUES (?)', [id]);
      const profile = await db.get('SELECT * FROM profiles WHERE id = ?', [id]);
      return res.status(201).json({ profile });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/auth/bootstrap-owner', auth, async (req, res, next) => {
    try {
      if (!process.env.OWNER_BOOTSTRAP_SECRET) {
        throw apiError(403, 'FORBIDDEN', 'Owner bootstrapping is not enabled on this server.');
      }
      const provided = String(req.body?.bootstrapSecret || req.header('x-owner-bootstrap-secret') || '');
      const expected = String(process.env.OWNER_BOOTSTRAP_SECRET);
      if (provided.length === 0 || provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
        throw apiError(403, 'FORBIDDEN', 'Invalid owner bootstrap secret.');
      }
      const canteenId = req.body?.canteenId || DEFAULT_CANTEEN_ID;
      await db.run("UPDATE profiles SET role = 'owner', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.user.id]);
      await db.run(
        "INSERT OR IGNORE INTO canteen_members (canteen_id, profile_id, role) VALUES (?, ?, 'owner')",
        [canteenId, req.user.id]
      );
      const updatedProfile = await db.get('SELECT * FROM profiles WHERE id = ?', [req.user.id]);
      return res.json({ ok: true, profile: updatedProfile, canteenId });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/me', auth, async (req, res) => {
    const preferences = await db.get('SELECT * FROM user_preferences WHERE profile_id = ?', [req.user.id]);
    res.json({ profile: req.user, preferences });
  });

  app.put('/api/me', auth, async (req, res, next) => {
    try {
      await db.run('UPDATE profiles SET name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.body.name || req.user.name, req.body.phone || req.user.phone, req.user.id]);
      await db.run(
        `INSERT INTO user_preferences (profile_id, dietary_preference, allergies, favorite_categories, budget_range, spice_preference, notification_preferences)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id) DO UPDATE SET dietary_preference = excluded.dietary_preference, allergies = excluded.allergies, favorite_categories = excluded.favorite_categories, budget_range = excluded.budget_range, spice_preference = excluded.spice_preference, notification_preferences = excluded.notification_preferences`,
        [req.user.id, req.body.dietaryPreference || null, JSON.stringify(req.body.allergies || []), JSON.stringify(req.body.favoriteCategories || []), req.body.budgetRange || null, req.body.spicePreference || null, JSON.stringify(req.body.notificationPreferences || {})]
      );
      const profile = await db.get('SELECT * FROM profiles WHERE id = ?', [req.user.id]);
      const preferences = await db.get('SELECT * FROM user_preferences WHERE profile_id = ?', [req.user.id]);
      res.json({ profile, preferences });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/menu', async (req, res) => {
    const rows = await db.all(
      `SELECT menu_items.*, inventory.stock_quantity, inventory.low_stock_threshold
       FROM menu_items LEFT JOIN inventory ON inventory.menu_item_id = menu_items.id
       WHERE menu_items.canteen_id = ? AND menu_items.is_active = 1
       ORDER BY menu_items.category, menu_items.name`,
      [req.query.canteenId || DEFAULT_CANTEEN_ID]
    );
    const categories = await db.all('SELECT * FROM menu_categories WHERE canteen_id = ? AND is_active = 1 ORDER BY sort_order, name', [req.query.canteenId || DEFAULT_CANTEEN_ID]);
    res.json({ items: rows.map(menuResponse), categories });
  });

  app.get('/api/offers', async (req, res) => {
    const offers = await db.all('SELECT * FROM offers WHERE canteen_id = ? AND is_active = 1 ORDER BY title', [DEFAULT_CANTEEN_ID]);
    res.json({ offers });
  });

  app.post('/api/orders', async (req, res, next) => {
    try {
      const hasAuth = req.header('authorization') || req.header('x-test-profile-id');
      const user = hasAuth ? await new Promise((resolve, reject) => auth(req, res, (error) => error ? reject(error) : resolve(req.user))) : null;
      const order = await createOrder(db, req.body, user);
      res.status(201).json({ order });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/orders/:id', async (req, res, next) => {
    try {
      const order = await getOrder(db, req.params.id);
      if (!order) throw apiError(404, 'NOT_FOUND', 'Order was not found.');
      if (order.customerId) {
        if (!req.header('authorization') && !(process.env.NODE_ENV === 'test' && req.header('x-test-profile-id'))) {
          throw apiError(401, 'UNAUTHENTICATED', 'Authentication is required to view this order.');
        }
        await new Promise((resolve, reject) => auth(req, res, (error) => error ? reject(error) : resolve()));
        const ownerAllowed = ['owner', 'staff', 'admin'].includes(req.user.role);
        if (!ownerAllowed && order.customerId !== req.user.id) throw apiError(403, 'FORBIDDEN', 'You can only access your own orders.');
      } else if (req.header('authorization') || (process.env.NODE_ENV === 'test' && req.header('x-test-profile-id'))) {
        await new Promise((resolve, reject) => auth(req, res, (error) => error ? reject(error) : resolve()));
      }
      res.json({ order });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/me/orders', auth, async (req, res) => {
    const rows = await db.all('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC', [req.user.id]);
    const orders = [];
    for (const row of rows) {
      orders.push(await getOrder(db, row.id));
    }
    res.json({ orders });
  });

  app.get('/api/users/:userId/orders', auth, async (req, res, next) => {
    try {
      if (req.params.userId !== req.user.id && !['admin', 'owner', 'staff'].includes(req.user.role)) {
        throw apiError(403, 'FORBIDDEN', 'You can only access your own order history.');
      }
      const rows = await db.all('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC', [req.params.userId]);
      const orders = [];
      for (const row of rows) orders.push(await getOrder(db, row.id));
      res.json({ orders });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/orders/:id/status', auth, requireRole('owner', 'staff', 'admin'), async (req, res, next) => {
    try {
      const order = await db.get('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
      if (!order) throw apiError(404, 'NOT_FOUND', 'Order was not found.');
      await requireCanteenMember(db, req, order.canteen_id);
      const nextStatus = req.body.status;
      const isCancellation = nextStatus === 'cancelled' || nextStatus === 'rejected';

      if (['cancelled', 'rejected'].includes(order.status)) {
        throw apiError(400, 'INVALID_STATUS_TRANSITION', `Order is already ${order.status}.`);
      }

      if (isCancellation) {
        if (order.status === 'completed') {
          throw apiError(400, 'INVALID_STATUS_TRANSITION', `Cannot ${nextStatus} an order that is already completed.`);
        }

        await db.withTransaction(async (tx) => {
          await tx.run('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [nextStatus, order.id]);
          await tx.run('INSERT INTO order_status_history (order_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?)', [order.id, order.status, nextStatus, req.user.id]);
          
          const items = await tx.all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
          for (const item of items) {
            await tx.run(
              'UPDATE inventory SET stock_quantity = stock_quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE menu_item_id = ?',
              [item.quantity, item.menu_item_id]
            );
            await tx.run(
              'INSERT INTO inventory_movements (menu_item_id, change_quantity, reason, created_by) VALUES (?, ?, ?, ?)',
              [item.menu_item_id, item.quantity, `Order ${order.token} ${nextStatus} restock`, req.user.id]
            );
          }
        });

        return res.json({ order: await getOrder(db, order.id) });
      }

      const currentIndex = ORDER_STATUSES.indexOf(order.status);
      const nextIndex = ORDER_STATUSES.indexOf(nextStatus);
      if (nextIndex !== currentIndex + 1) {
        throw apiError(400, 'INVALID_STATUS_TRANSITION', `Order status must move to ${ORDER_STATUSES[currentIndex + 1] || 'no further stage'}.`);
      }

      await db.run('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [nextStatus, order.id]);
      await db.run('INSERT INTO order_status_history (order_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?)', [order.id, order.status, nextStatus, req.user.id]);
      res.json({ order: await getOrder(db, order.id) });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/orders/:id/payment', auth, requireRole('owner', 'staff', 'admin'), async (req, res, next) => {
    try {
      const order = await db.get('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
      if (!order) throw apiError(404, 'NOT_FOUND', 'Order was not found.');
      await requireCanteenMember(db, req, order.canteen_id);

      const requestedPaymentStatus = req.body.paymentStatus;
      if (!['paid', 'unpaid'].includes(requestedPaymentStatus)) {
        throw apiError(400, 'VALIDATION_ERROR', 'paymentStatus must be either "paid" or "unpaid".');
      }

      if (order.payment_method !== 'cash') {
        throw apiError(400, 'INVALID_PAYMENT_ACTION', `Electronic ${order.payment_method.toUpperCase()} payments cannot be manually altered; electronic payment gateway integration is pending.`);
      }

      await db.run(
        'UPDATE orders SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [requestedPaymentStatus, order.id]
      );
      res.json({ order: await getOrder(db, order.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/feedback', auth, async (req, res, next) => {
    try {
      const rating = Number(req.body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw apiError(400, 'VALIDATION_ERROR', 'Rating must be between 1 and 5.');
      if (req.body.orderId) {
        const order = await db.get('SELECT * FROM orders WHERE id = ?', [Number(req.body.orderId)]);
        if (!order || order.customer_id !== req.user.id) throw apiError(403, 'FORBIDDEN', 'You can only review your own orders.');
      }
      await db.run('INSERT INTO feedback (order_id, customer_id, rating, comment) VALUES (?, ?, ?, ?)', [req.body.orderId || null, req.user.id, rating, req.body.comment || null]);
      res.status(201).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/owner/summary', auth, requireRole('owner', 'staff', 'admin'), async (req, res, next) => {
    try {
      const canteenId = await loadOwnerCanteen(db, req.user);
      await requireCanteenMember(db, req, canteenId);
      const orders = await db.all('SELECT * FROM orders WHERE canteen_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [canteenId]);
      const lowStock = await db.all(
        `SELECT menu_items.name, inventory.stock_quantity, inventory.low_stock_threshold
         FROM inventory JOIN menu_items ON menu_items.id = inventory.menu_item_id
         WHERE menu_items.canteen_id = ? AND inventory.stock_quantity <= inventory.low_stock_threshold
         ORDER BY inventory.stock_quantity ASC`,
        [canteenId]
      );
      const bestSellers = await db.all(
        `SELECT order_items.name_snapshot AS name, SUM(order_items.quantity) AS quantity, SUM(order_items.line_total_cents) AS sales_cents
         FROM order_items JOIN orders ON orders.id = order_items.order_id
         WHERE orders.canteen_id = ? AND orders.status NOT IN ('cancelled', 'rejected') AND orders.payment_status IN ('unpaid', 'pending', 'paid')
         GROUP BY order_items.name_snapshot
         ORDER BY quantity DESC
         LIMIT 5`,
        [canteenId]
      );
      const totals = await db.get(
        `SELECT COUNT(*) AS total_orders, SUM(total_cents) AS gross_cents,
                SUM(CASE WHEN payment_status = 'paid' THEN total_cents ELSE 0 END) AS paid_cents,
                SUM(CASE WHEN payment_status != 'paid' THEN total_cents ELSE 0 END) AS unpaid_cents
         FROM orders WHERE canteen_id = ? AND status NOT IN ('cancelled', 'rejected')`,
        [canteenId]
      );
      res.json({
        canteenId,
        totals: {
          totalOrders: Number(totals.total_orders || 0),
          grossSales: centsToRupees(totals.gross_cents || 0),
          paidSales: centsToRupees(totals.paid_cents || 0),
          unpaidSales: centsToRupees(totals.unpaid_cents || 0)
        },
        recentOrders: orders.map((order) => orderResponse(order)),
        bestSellers: bestSellers.map((item) => ({ name: item.name, quantity: Number(item.quantity), sales: centsToRupees(item.sales_cents) })),
        lowStock
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/owner/canteen', auth, requireRole('owner', 'staff', 'admin'), async (req, res, next) => {
    try {
      const canteenId = await loadOwnerCanteen(db, req.user);
      const canteen = await db.get('SELECT * FROM canteens WHERE id = ?', [canteenId]);
      res.json({ canteen: { ...canteen, openingHours: parseJson(canteen.opening_hours, {}), pickupLocations: parseJson(canteen.pickup_locations, []) } });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/owner/canteen', auth, requireRole('owner', 'admin'), async (req, res, next) => {
    try {
      const canteenId = await loadOwnerCanteen(db, req.user);
      await db.run(
        'UPDATE canteens SET name = ?, description = ?, contact_phone = ?, opening_hours = ?, pickup_locations = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [req.body.name, req.body.description || '', req.body.contactPhone || '', JSON.stringify(req.body.openingHours || {}), JSON.stringify(req.body.pickupLocations || []), canteenId]
      );
      const canteen = await db.get('SELECT * FROM canteens WHERE id = ?', [canteenId]);
      res.json({ canteen });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/owner/menu', auth, requireRole('owner', 'staff', 'admin'), async (req, res, next) => {
    try {
      const canteenId = await loadOwnerCanteen(db, req.user);
      const items = await db.all(
        `SELECT menu_items.*, inventory.stock_quantity, inventory.low_stock_threshold
         FROM menu_items LEFT JOIN inventory ON inventory.menu_item_id = menu_items.id
         WHERE menu_items.canteen_id = ?
         ORDER BY menu_items.category, menu_items.name`,
        [canteenId]
      );
      const categories = await db.all('SELECT * FROM menu_categories WHERE canteen_id = ? ORDER BY sort_order, name', [canteenId]);
      res.json({ items: items.map(menuResponse), categories });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/owner/menu', auth, requireRole('owner', 'admin'), async (req, res, next) => {
    try {
      const canteenId = await loadOwnerCanteen(db, req.user);
      const id = uuid();
      const category = req.body.category || 'Burgers';
      const categoryId = `cat_${category.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      await db.run('INSERT OR IGNORE INTO menu_categories (id, canteen_id, name, sort_order) VALUES (?, ?, ?, ?)', [categoryId, canteenId, category, 99]);
      await db.run(
        `INSERT INTO menu_items (id, canteen_id, category_id, name, description, category, price_cents, image_url, is_available, is_active, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, canteenId, categoryId, req.body.name, req.body.description || '', category, Math.round(Number(req.body.price || 0) * 100), req.body.imageUrl || '', req.body.isAvailable === false ? 0 : 1, 1, JSON.stringify(req.body.tags || [])]
      );
      await db.run('INSERT INTO inventory (menu_item_id, stock_quantity, low_stock_threshold) VALUES (?, ?, ?)', [id, Number(req.body.stockQuantity || 0), Number(req.body.lowStockThreshold || 5)]);
      res.status(201).json({ item: menuResponse(await db.get('SELECT menu_items.*, inventory.stock_quantity, inventory.low_stock_threshold FROM menu_items LEFT JOIN inventory ON inventory.menu_item_id = menu_items.id WHERE menu_items.id = ?', [id])) });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/owner/menu/:id', auth, requireRole('owner', 'admin'), async (req, res, next) => {
    try {
      const canteenId = await loadOwnerCanteen(db, req.user);
      const item = await db.get('SELECT * FROM menu_items WHERE id = ? AND canteen_id = ?', [req.params.id, canteenId]);
      if (!item) throw apiError(404, 'NOT_FOUND', 'Menu item was not found.');
      await db.run(
        'UPDATE menu_items SET name = ?, description = ?, category = ?, price_cents = ?, image_url = ?, is_available = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [req.body.name, req.body.description || '', req.body.category, Math.round(Number(req.body.price || 0) * 100), req.body.imageUrl || '', req.body.isAvailable ? 1 : 0, req.body.isActive === false ? 0 : 1, req.params.id]
      );
      await db.run('UPDATE inventory SET stock_quantity = ?, low_stock_threshold = ?, updated_at = CURRENT_TIMESTAMP WHERE menu_item_id = ?', [Number(req.body.stockQuantity || 0), Number(req.body.lowStockThreshold || 5), req.params.id]);
      res.json({ item: menuResponse(await db.get('SELECT menu_items.*, inventory.stock_quantity, inventory.low_stock_threshold FROM menu_items LEFT JOIN inventory ON inventory.menu_item_id = menu_items.id WHERE menu_items.id = ?', [req.params.id])) });
    } catch (error) {
      next(error);
    }
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = {
  createApp
};
