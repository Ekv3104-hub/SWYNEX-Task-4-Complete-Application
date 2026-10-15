function toOrderResponse(order, items = []) {
  if (!order) {
    return null;
  }

  return {
    id: order.id,
    token: order.token,
    userId: order.user_id,
    customerName: order.customer_name,
    phone: order.phone,
    pickupSpot: order.pickup_spot,
    pickupTime: order.pickup_time,
    paymentMethod: order.payment_method,
    subtotal: order.subtotal,
    tax: order.tax,
    total: order.total,
    status: order.status,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: items.map((item) => ({
      id: item.id,
      menuItemId: item.menu_item_id,
      name: item.name_snapshot,
      unitPrice: item.price_snapshot,
      quantity: item.quantity,
      lineTotal: item.line_total
    }))
  };
}

async function createOrder(db, orderData, menuItemsById) {
  const enrichedItems = orderData.items.map((item) => {
    const menuItem = menuItemsById.get(item.menuItemId);
    return {
      ...item,
      nameSnapshot: menuItem.name,
      priceSnapshot: menuItem.price,
      lineTotal: menuItem.price * item.quantity
    };
  });

  const subtotal = enrichedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const tax = Math.round(subtotal * 0.05);
  const total = subtotal + tax;

  await db.exec('BEGIN');
  try {
    const result = await db.run(
      `INSERT INTO orders
       (user_id, customer_name, phone, pickup_spot, pickup_time, payment_method, subtotal, tax, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      orderData.userId || null,
      orderData.customerName,
      orderData.phone,
      orderData.pickupSpot,
      orderData.pickupTime,
      orderData.paymentMethod,
      subtotal,
      tax,
      total
    );

    const orderId = result.lastID;
    const token = `#FQ-${String(orderId).padStart(4, '0')}`;
    await db.run('UPDATE orders SET token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', token, orderId);

    for (const item of enrichedItems) {
      await db.run(
        `INSERT INTO order_items
         (order_id, menu_item_id, name_snapshot, price_snapshot, quantity, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        orderId,
        item.menuItemId,
        item.nameSnapshot,
        item.priceSnapshot,
        item.quantity,
        item.lineTotal
      );
    }

    await db.exec('COMMIT');
    return getOrderById(db, orderId);
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function getOrderById(db, orderId) {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) {
    return null;
  }

  const items = await db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', orderId);
  return toOrderResponse(order, items);
}

async function getOrdersByUserId(db, userId) {
  const orders = await db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC', userId);
  const results = [];

  for (const order of orders) {
    const items = await db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', order.id);
    results.push(toOrderResponse(order, items));
  }

  return results;
}

async function updateOrderStatus(db, orderId, status) {
  const result = await db.run(
    'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    status,
    orderId
  );

  return result.changes > 0 ? getOrderById(db, orderId) : null;
}

module.exports = {
  createOrder,
  getOrderById,
  getOrdersByUserId,
  updateOrderStatus
};
