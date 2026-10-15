const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const request = require('supertest');

process.env.NODE_ENV = 'test';

const { createApp } = require('../src/app');
const { DEFAULT_OWNER_ID, initializeDatabase, uuid } = require('../src/db/database');

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'foodqueue-task4-'));
  const db = await initializeDatabase(path.join(directory, 'task4.db'));
  const app = createApp(db);
  t.after(async () => {
    await db.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { app, db };
}

async function createCustomer(db, name = 'Ethan Vance') {
  const id = uuid();
  await db.run(
    'INSERT INTO profiles (id, auth_user_id, name, email, phone, role) VALUES (?, ?, ?, ?, ?, ?)',
    [id, `auth-${id}`, name, `${id}@example.com`, '+919876543210', 'customer']
  );
  await db.run('INSERT INTO user_preferences (profile_id) VALUES (?)', [id]);
  return id;
}

function orderPayload(overrides = {}) {
  return {
    customerName: 'Ethan Vance',
    phone: '+91 98765 43210',
    pickupSpot: 'Table 12 (Main Floor)',
    pickupTime: '12:30',
    paymentMethod: 'cash',
    items: [{ menuItemId: 'food_1', quantity: 2 }],
    ...overrides
  };
}

test('serves seeded menu from the backend with stock and availability', async (t) => {
  const { app } = await setup(t);
  const response = await request(app).get('/api/menu');

  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, 8);
  assert.equal(response.body.items[0].stockQuantity > 0, true);
  assert.equal(response.body.categories.some((category) => category.name === 'Burgers'), true);
});

test('creates an order with server totals, unpaid cash payment status, and inventory decrement', async (t) => {
  const { app, db } = await setup(t);
  const customerId = await createCustomer(db);

  const created = await request(app)
    .post('/api/orders')
    .set('x-test-profile-id', customerId)
    .send(orderPayload());

  assert.equal(created.status, 201);
  assert.equal(created.body.order.token, '#FQ-0001');
  assert.equal(created.body.order.subtotal, 298);
  assert.equal(created.body.order.tax, 15);
  assert.equal(created.body.order.total, 313);
  assert.equal(created.body.order.paymentStatus, 'unpaid');

  const inventory = await db.get('SELECT stock_quantity FROM inventory WHERE menu_item_id = ?', ['food_1']);
  assert.equal(inventory.stock_quantity, 23);
});

test('customers can only read their own authenticated order history', async (t) => {
  const { app, db } = await setup(t);
  const customerA = await createCustomer(db, 'Customer A');
  const customerB = await createCustomer(db, 'Customer B');

  await request(app).post('/api/orders').set('x-test-profile-id', customerA).send(orderPayload());

  const ownHistory = await request(app).get('/api/me/orders').set('x-test-profile-id', customerA);
  const otherHistory = await request(app).get(`/api/users/${customerA}/orders`).set('x-test-profile-id', customerB);

  assert.equal(ownHistory.status, 200);
  assert.equal(ownHistory.body.orders.length, 1);
  assert.equal(otherHistory.status, 403);
});

test('owner can manage menu and advance assigned canteen orders', async (t) => {
  const { app, db } = await setup(t);
  const customerId = await createCustomer(db);
  const created = await request(app).post('/api/orders').set('x-test-profile-id', customerId).send(orderPayload());

  const itemUpdate = await request(app)
    .put('/api/owner/menu/food_1')
    .set('x-test-profile-id', DEFAULT_OWNER_ID)
    .send({
      name: 'Classic Burger',
      description: 'Updated owner description',
      category: 'Burgers',
      price: 155,
      imageUrl: 'https://example.com/burger.jpg',
      stockQuantity: 10,
      lowStockThreshold: 4,
      isAvailable: true,
      isActive: true
    });

  const statusUpdate = await request(app)
    .patch(`/api/orders/${created.body.order.id}/status`)
    .set('x-test-profile-id', DEFAULT_OWNER_ID)
    .send({ status: 'preparing' });

  assert.equal(itemUpdate.status, 200);
  assert.equal(itemUpdate.body.item.price, 155);
  assert.equal(itemUpdate.body.item.stockQuantity, 10);
  assert.equal(statusUpdate.status, 200);
  assert.equal(statusUpdate.body.order.status, 'preparing');
});

test('owner summary reports sales, unpaid status, best sellers, and low stock', async (t) => {
  const { app, db } = await setup(t);
  const customerId = await createCustomer(db);
  await request(app).post('/api/orders').set('x-test-profile-id', customerId).send(orderPayload());
  await db.run('UPDATE inventory SET stock_quantity = 2 WHERE menu_item_id = ?', ['food_1']);

  const response = await request(app)
    .get('/api/owner/summary')
    .set('x-test-profile-id', DEFAULT_OWNER_ID);

  assert.equal(response.status, 200);
  assert.equal(response.body.totals.totalOrders, 1);
  assert.equal(response.body.totals.unpaidSales, 313);
  assert.equal(response.body.bestSellers[0].name, 'Classic Burger');
  assert.equal(response.body.lowStock.some((item) => item.name === 'Classic Burger'), true);
});

test('unauthorized users cannot access owner dashboard APIs', async (t) => {
  const { app, db } = await setup(t);
  const customerId = await createCustomer(db);

  const response = await request(app)
    .get('/api/owner/summary')
    .set('x-test-profile-id', customerId);

  assert.equal(response.status, 403);
});

const crypto = require('node:crypto');

function makeHs256Jwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

test('rejects expired JWT token with 401 TOKEN_EXPIRED', async (t) => {
  const { app, db } = await setup(t);
  const secret = 'test-supabase-secret-with-adequate-length-12345';
  process.env.SUPABASE_JWT_SECRET = secret;
  t.after(() => { delete process.env.SUPABASE_JWT_SECRET; });

  const customerId = await createCustomer(db);
  const profile = await db.get('SELECT auth_user_id FROM profiles WHERE id = ?', [customerId]);
  const expiredPayload = {
    sub: profile.auth_user_id,
    exp: Math.floor(Date.now() / 1000) - 300 // expired 5 minutes ago
  };
  const token = makeHs256Jwt(expiredPayload, secret);

  const res = await request(app)
    .get('/api/me')
    .set('authorization', `Bearer ${token}`);

  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'TOKEN_EXPIRED');
});

test('rejects tampered or invalid JWT signature with 401 INVALID_TOKEN', async (t) => {
  const { app, db } = await setup(t);
  const secret = 'test-supabase-secret-with-adequate-length-12345';
  process.env.SUPABASE_JWT_SECRET = secret;
  t.after(() => { delete process.env.SUPABASE_JWT_SECRET; });

  const customerId = await createCustomer(db);
  const profile = await db.get('SELECT auth_user_id FROM profiles WHERE id = ?', [customerId]);
  const token = makeHs256Jwt({ sub: profile.auth_user_id }, 'wrong-secret');

  const res = await request(app)
    .get('/api/me')
    .set('authorization', `Bearer ${token}`);

  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'INVALID_TOKEN');
});

test('strictly rejects demo authentication in production mode', async (t) => {
  const { app, db } = await setup(t);
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => { process.env.NODE_ENV = origEnv; });

  const payload = Buffer.from(JSON.stringify({ sub: 'demo-user', email: 'user@test.local' })).toString('base64url');
  const demoToken = `demo.${payload}.sig`;

  const res = await request(app)
    .get('/api/me')
    .set('authorization', `Bearer ${demoToken}`);

  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'DEMO_AUTH_DISABLED');
});

test('unauthenticated users cannot view orders placed by registered customers', async (t) => {
  const { app, db } = await setup(t);
  const customerId = await createCustomer(db);
  const created = await request(app)
    .post('/api/orders')
    .set('x-test-profile-id', customerId)
    .send(orderPayload());

  const orderId = created.body.order.id;

  // Unauthenticated request
  const unauthRes = await request(app).get(`/api/orders/${orderId}`);
  assert.equal(unauthRes.status, 401);
  assert.equal(unauthRes.body.error.code, 'UNAUTHENTICATED');

  // Customer A accesses their order
  const authRes = await request(app)
    .get(`/api/orders/${orderId}`)
    .set('x-test-profile-id', customerId);
  assert.equal(authRes.status, 200);
  assert.equal(authRes.body.order.id, orderId);

  // Customer B gets 403
  const otherCustomerId = await createCustomer(db, 'Another Customer');
  const otherRes = await request(app)
    .get(`/api/orders/${orderId}`)
    .set('x-test-profile-id', otherCustomerId);
  assert.equal(otherRes.status, 403);
});

test('secure owner bootstrap requires valid server secret and promotes user', async (t) => {
  const { app, db } = await setup(t);
  process.env.OWNER_BOOTSTRAP_SECRET = 'super-secret-admin-key-2026';
  t.after(() => { delete process.env.OWNER_BOOTSTRAP_SECRET; });

  const customerId = await createCustomer(db, 'Future Owner');

  // Attempt with wrong secret
  const badRes = await request(app)
    .post('/api/auth/bootstrap-owner')
    .set('x-test-profile-id', customerId)
    .send({ bootstrapSecret: 'wrong-secret' });
  assert.equal(badRes.status, 403);

  // Attempt with correct secret
  const goodRes = await request(app)
    .post('/api/auth/bootstrap-owner')
    .set('x-test-profile-id', customerId)
    .send({ bootstrapSecret: 'super-secret-admin-key-2026' });
  assert.equal(goodRes.status, 200);
  assert.equal(goodRes.body.profile.role, 'owner');

  // The newly promoted owner can now access owner summary
  const summaryRes = await request(app)
    .get('/api/owner/summary')
    .set('x-test-profile-id', customerId);
  assert.equal(summaryRes.status, 200);
});

test('atomic transaction rolls back and returns 400 when inventory is insufficient', async (t) => {
  const { app, db } = await setup(t);
  const customerId = await createCustomer(db);

  // Set stock to 2
  await db.run('UPDATE inventory SET stock_quantity = 2 WHERE menu_item_id = ?', ['food_1']);

  // Attempt to buy 5 items (exceeds stock)
  const res = await request(app)
    .post('/api/orders')
    .set('x-test-profile-id', customerId)
    .send(orderPayload({ items: [{ menuItemId: 'food_1', quantity: 5 }] }));

  assert.equal(res.status, 400);

  // Verify stock was not decremented and remains 2
  const inv = await db.get('SELECT stock_quantity FROM inventory WHERE menu_item_id = ?', ['food_1']);
  assert.equal(inv.stock_quantity, 2);

  // Verify no order was inserted
  const orders = await db.all('SELECT * FROM orders WHERE customer_id = ?', [customerId]);
  assert.equal(orders.length, 0);
});

test('CORS rejects preflight and withholds header for unapproved origins in production', async (t) => {
  const { app } = await setup(t);
  const origEnv = process.env.NODE_ENV;
  const origCors = process.env.CORS_ORIGINS;
  process.env.NODE_ENV = 'production';
  process.env.CORS_ORIGINS = 'https://foodqueue.app,https://canteen.foodqueue.app';
  t.after(() => {
    process.env.NODE_ENV = origEnv;
    process.env.CORS_ORIGINS = origCors;
  });

  // Approved origin OPTIONS
  const approvedPreflight = await request(app)
    .options('/api/menu')
    .set('Origin', 'https://foodqueue.app');
  assert.equal(approvedPreflight.status, 204);
  assert.equal(approvedPreflight.headers['access-control-allow-origin'], 'https://foodqueue.app');

  // Disallowed origin OPTIONS
  const disallowedPreflight = await request(app)
    .options('/api/menu')
    .set('Origin', 'https://malicious-site.com');
  assert.equal(disallowedPreflight.status, 403);

  // Disallowed origin GET
  const disallowedGet = await request(app)
    .get('/api/menu')
    .set('Origin', 'https://malicious-site.com');
  assert.equal(disallowedGet.headers['access-control-allow-origin'], undefined);
});

test('owner can verify and mark cash orders as paid, but electronic payments cannot be manually marked paid', async (t) => {
  const { app, db } = await setup(t);
  const customerId = await createCustomer(db);

  // 1. Cash order
  const cashRes = await request(app)
    .post('/api/orders')
    .set('x-test-profile-id', customerId)
    .send(orderPayload({ paymentMethod: 'cash' }));
  const cashOrderId = cashRes.body.order.id;
  assert.equal(cashRes.body.order.paymentStatus, 'unpaid');

  // Customer cannot mark paid (requires owner/staff)
  const custAttempt = await request(app)
    .patch(`/api/orders/${cashOrderId}/payment`)
    .set('x-test-profile-id', customerId)
    .send({ paymentStatus: 'paid' });
  assert.equal(custAttempt.status, 403);

  // Owner marks cash order as paid
  const ownerPaidRes = await request(app)
    .patch(`/api/orders/${cashOrderId}/payment`)
    .set('x-test-profile-id', DEFAULT_OWNER_ID)
    .send({ paymentStatus: 'paid' });
  assert.equal(ownerPaidRes.status, 200);
  assert.equal(ownerPaidRes.body.order.paymentStatus, 'paid');

  // 2. Electronic payment (UPI) order
  const upiRes = await request(app)
    .post('/api/orders')
    .set('x-test-profile-id', customerId)
    .send(orderPayload({ paymentMethod: 'upi' }));
  const upiOrderId = upiRes.body.order.id;
  assert.equal(upiRes.body.order.paymentStatus, 'pending');

  // Owner attempts to manually mark UPI as paid -> rejected
  const ownerUpiAttempt = await request(app)
    .patch(`/api/orders/${upiOrderId}/payment`)
    .set('x-test-profile-id', DEFAULT_OWNER_ID)
    .send({ paymentStatus: 'paid' });
  assert.equal(ownerUpiAttempt.status, 400);
  assert.equal(ownerUpiAttempt.body.error.code, 'INVALID_PAYMENT_ACTION');
});

test('order cancellation or rejection restores inventory and records inventory movement', async (t) => {
  const { app, db } = await setup(t);
  const customerId = await createCustomer(db);

  // Check initial stock of food_2
  const initialInv = await db.get('SELECT stock_quantity FROM inventory WHERE menu_item_id = ?', ['food_2']);
  const initialStock = initialInv.stock_quantity;

  // Place order for 3 items of food_2
  const orderRes = await request(app)
    .post('/api/orders')
    .set('x-test-profile-id', customerId)
    .send(orderPayload({ items: [{ menuItemId: 'food_2', quantity: 3 }] }));
  const orderId = orderRes.body.order.id;

  // Stock should be decremented
  const midInv = await db.get('SELECT stock_quantity FROM inventory WHERE menu_item_id = ?', ['food_2']);
  assert.equal(midInv.stock_quantity, initialStock - 3);

  // Owner cancels the order
  const cancelRes = await request(app)
    .patch(`/api/orders/${orderId}/status`)
    .set('x-test-profile-id', DEFAULT_OWNER_ID)
    .send({ status: 'cancelled' });
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.body.order.status, 'cancelled');

  // Stock must be restored to initial quantity
  const restoredInv = await db.get('SELECT stock_quantity FROM inventory WHERE menu_item_id = ?', ['food_2']);
  assert.equal(restoredInv.stock_quantity, initialStock);

  // Inventory movement record must exist
  const movement = await db.get(
    "SELECT * FROM inventory_movements WHERE menu_item_id = ? AND reason LIKE '%cancelled restock%' ORDER BY id DESC",
    ['food_2']
  );
  assert.ok(movement);
  assert.equal(movement.change_quantity, 3);
});

test('completed orders cannot be cancelled or rejected', async (t) => {
  const { app, db } = await setup(t);
  const customerId = await createCustomer(db);

  const orderRes = await request(app)
    .post('/api/orders')
    .set('x-test-profile-id', customerId)
    .send(orderPayload());
  const orderId = orderRes.body.order.id;

  // Advance order to completed
  await request(app).patch(`/api/orders/${orderId}/status`).set('x-test-profile-id', DEFAULT_OWNER_ID).send({ status: 'preparing' });
  await request(app).patch(`/api/orders/${orderId}/status`).set('x-test-profile-id', DEFAULT_OWNER_ID).send({ status: 'ready_for_pickup' });
  await request(app).patch(`/api/orders/${orderId}/status`).set('x-test-profile-id', DEFAULT_OWNER_ID).send({ status: 'completed' });

  // Try to cancel completed order
  const cancelRes = await request(app)
    .patch(`/api/orders/${orderId}/status`)
    .set('x-test-profile-id', DEFAULT_OWNER_ID)
    .send({ status: 'cancelled' });
  assert.equal(cancelRes.status, 400);
  assert.equal(cancelRes.body.error.code, 'INVALID_STATUS_TRANSITION');
});

test('feedback submissions validate ratings and isolate order reviews to the purchaser', async (t) => {
  const { app, db } = await setup(t);
  const customerA = await createCustomer(db, 'Customer A');
  const customerB = await createCustomer(db, 'Customer B');

  const orderRes = await request(app)
    .post('/api/orders')
    .set('x-test-profile-id', customerA)
    .send(orderPayload());
  const orderId = orderRes.body.order.id;

  // Customer A submits valid feedback
  const feedbackRes = await request(app)
    .post('/api/feedback')
    .set('x-test-profile-id', customerA)
    .send({ orderId, rating: 5, comment: 'Delicious food!' });
  assert.equal(feedbackRes.status, 201);
  assert.equal(feedbackRes.body.ok, true);

  // Customer B cannot submit feedback for Customer A's order
  const forbiddenRes = await request(app)
    .post('/api/feedback')
    .set('x-test-profile-id', customerB)
    .send({ orderId, rating: 1, comment: 'Sneaky review' });
  assert.equal(forbiddenRes.status, 403);

  // Invalid rating validation
  const invalidRatingRes = await request(app)
    .post('/api/feedback')
    .set('x-test-profile-id', customerA)
    .send({ orderId, rating: 6 });
  assert.equal(invalidRatingRes.status, 400);
});

test('offers endpoint returns active offers for the canteen', async (t) => {
  const { app } = await setup(t);
  const res = await request(app).get('/api/offers');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.offers));
  assert.ok(res.body.offers.length > 0);
});

