const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');

const DEFAULT_DATABASE_PATH = path.join(__dirname, '../../data/foodqueue-task4.db');
const DEFAULT_CANTEEN_ID = '11111111-1111-4111-8111-111111111111';
const DEFAULT_OWNER_ID = '22222222-2222-4222-8222-222222222222';

const MENU_SEED_DATA = [
  ['food_1', 'Classic Burger', 'Juicy patty, fresh crisp veggies, melted cheddar & signature smoky sauce.', 'Burgers', 14900, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=500&auto=format&fit=crop', 25, 1, '["Bestseller"]'],
  ['food_2', 'Peri Peri Fries', 'Golden crisp crinkle cut potato fries dusted with zesty African bird’s eye seasoning.', 'Burgers', 9900, 'https://images.unsplash.com/photo-1576107232684-1279f3908594?q=80&w=500&auto=format&fit=crop', 40, 1, '["Popular"]'],
  ['food_3', 'Margherita Pizza', 'San Marzano tomato base, hand-torn buffalo mozzarella and aromatic fresh basil.', 'Pizza', 19900, 'https://images.unsplash.com/photo-1604382355076-af4b0eb60143?q=80&w=500&auto=format&fit=crop', 18, 1, '["Chef Pick"]'],
  ['food_4', 'Creamy Alfredo Pasta', 'Rich velvety parmesan sauce tossed with penne, garden herbs and cracked pepper.', 'Pasta', 17900, 'https://images.unsplash.com/photo-1645112411341-6c4fd023714a?q=80&w=500&auto=format&fit=crop', 14, 1, '["Rich & Creamy"]'],
  ['food_5', 'Iced Coffee', 'Chilled bold cold brew espresso poured over whole milk with mild vanilla sweetness.', 'Beverages', 12900, 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?q=80&w=500&auto=format&fit=crop', 50, 1, '["Chilled"]'],
  ['food_6', 'Paneer Tikka Roll', 'Smoky clay-oven paneer cubes wrapped in layered paratha with mint relish.', 'Indian', 13900, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=500&auto=format&fit=crop', 22, 1, '["Spicy"]'],
  ['food_7', 'Warm Chocolate Brownie', 'Dense Belgian chocolate fudge cake served warm with chocolate drizzle.', 'Desserts', 11900, 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?q=80&w=500&auto=format&fit=crop', 16, 1, '["Sweet Treat"]'],
  ['food_8', 'Masala Chai Flask', 'Traditional campus style tea brewed slow with freshly crushed cardamom & ginger.', 'Beverages', 6900, 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?q=80&w=500&auto=format&fit=crop', 60, 1, '["Campus Fav"]']
];

const CATEGORIES = ['Burgers', 'Pizza', 'Indian', 'Pasta', 'Beverages', 'Desserts'];

function uuid() {
  return crypto.randomUUID();
}

function toPg(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function normalizeRow(row) {
  if (!row) return row;
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return normalized;
}

async function createSqlite(databasePath) {
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON');
  return {
    kind: 'sqlite',
    async exec(sql) {
      return database.exec(sql);
    },
    async run(sql, parameters = []) {
      const result = database.prepare(sql).run(...parameters);
      return { changes: Number(result.changes), lastID: Number(result.lastInsertRowid) };
    },
    async get(sql, parameters = []) {
      return normalizeRow(database.prepare(sql).get(...parameters));
    },
    async all(sql, parameters = []) {
      return database.prepare(sql).all(...parameters).map(normalizeRow);
    },
    async close() {
      database.close();
    },
    async withTransaction(callback) {
      database.exec('BEGIN IMMEDIATE');
      const tx = {
        kind: 'sqlite',
        async exec(sql) {
          return database.exec(sql);
        },
        async run(sql, parameters = []) {
          const result = database.prepare(sql).run(...parameters);
          return { changes: Number(result.changes), lastID: Number(result.lastInsertRowid) };
        },
        async get(sql, parameters = []) {
          return normalizeRow(database.prepare(sql).get(...parameters));
        },
        async all(sql, parameters = []) {
          return database.prepare(sql).all(...parameters).map(normalizeRow);
        }
      };
      try {
        const result = await callback(tx);
        database.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          database.exec('ROLLBACK');
        } catch (_) {}
        throw error;
      }
    }
  };
}

async function createPostgres(databaseUrl) {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }
  });
  return {
    kind: 'postgres',
    pool,
    async exec(sql) {
      return pool.query(sql);
    },
    async run(sql, parameters = []) {
      const trimmed = sql.trim();
      const pgSql = trimmed.startsWith('INSERT OR IGNORE')
        ? toPg(sql.replace('INSERT OR IGNORE', 'INSERT')) + ' ON CONFLICT DO NOTHING'
        : toPg(sql) + (/^INSERT INTO orders\b/i.test(trimmed) ? ' RETURNING id' : '');
      const result = await pool.query(pgSql, parameters);
      return { changes: result.rowCount, lastID: result.rows?.[0]?.id };
    },
    async get(sql, parameters = []) {
      const result = await pool.query(toPg(sql), parameters);
      return normalizeRow(result.rows[0]);
    },
    async all(sql, parameters = []) {
      const result = await pool.query(toPg(sql), parameters);
      return result.rows.map(normalizeRow);
    },
    async close() {
      await pool.end();
    },
    async withTransaction(callback) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx = {
          kind: 'postgres',
          async exec(sql) {
            return client.query(sql);
          },
          async run(sql, parameters = []) {
            const trimmed = sql.trim();
            const pgSql = trimmed.startsWith('INSERT OR IGNORE')
              ? toPg(sql.replace('INSERT OR IGNORE', 'INSERT')) + ' ON CONFLICT DO NOTHING'
              : toPg(sql) + (/^INSERT INTO orders\b/i.test(trimmed) ? ' RETURNING id' : '');
            const result = await client.query(pgSql, parameters);
            return { changes: result.rowCount, lastID: result.rows?.[0]?.id };
          },
          async get(sql, parameters = []) {
            const result = await client.query(toPg(sql), parameters);
            return normalizeRow(result.rows[0]);
          },
          async all(sql, parameters = []) {
            const result = await client.query(toPg(sql), parameters);
            return result.rows.map(normalizeRow);
          }
        };
        const result = await callback(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

async function initializeDatabase(databasePath = DEFAULT_DATABASE_PATH) {
  const db = process.env.DATABASE_URL
    ? await createPostgres(process.env.DATABASE_URL)
    : await createSqlite(databasePath);

  await migrate(db);
  if (process.env.SKIP_SEED !== 'true') {
    await seed(db);
  }
  return db;
}

async function migrate(db) {
  const autoId = db.kind === 'postgres' ? 'INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';

  await db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      auth_user_id TEXT UNIQUE,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'owner', 'staff', 'admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS canteens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      contact_phone TEXT,
      opening_hours TEXT NOT NULL DEFAULT '{}',
      pickup_locations TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS canteen_members (
      canteen_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (canteen_id, profile_id),
      FOREIGN KEY (canteen_id) REFERENCES canteens(id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );

    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY,
      canteen_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (canteen_id) REFERENCES canteens(id),
      UNIQUE (canteen_id, name)
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      canteen_id TEXT NOT NULL,
      category_id TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      image_url TEXT,
      is_available INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      prep_time_minutes INTEGER,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (canteen_id) REFERENCES canteens(id),
      FOREIGN KEY (category_id) REFERENCES menu_categories(id)
    );

    CREATE TABLE IF NOT EXISTS inventory (
      menu_item_id TEXT PRIMARY KEY,
      stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
      low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id ${autoId},
      menu_item_id TEXT NOT NULL,
      change_quantity INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id ${autoId},
      token TEXT UNIQUE,
      canteen_id TEXT NOT NULL,
      customer_id TEXT,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      pickup_spot TEXT NOT NULL,
      pickup_time TEXT NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('upi', 'card', 'cash')),
      payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded')),
      subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
      tax_cents INTEGER NOT NULL CHECK (tax_cents >= 0),
      discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      status TEXT NOT NULL DEFAULT 'order_placed' CHECK (status IN ('order_placed', 'preparing', 'ready_for_pickup', 'completed', 'cancelled', 'rejected')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (canteen_id) REFERENCES canteens(id),
      FOREIGN KEY (customer_id) REFERENCES profiles(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id ${autoId},
      order_id INTEGER NOT NULL,
      menu_item_id TEXT NOT NULL,
      name_snapshot TEXT NOT NULL,
      price_snapshot_cents INTEGER NOT NULL CHECK (price_snapshot_cents >= 0),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    );

    CREATE TABLE IF NOT EXISTS order_status_history (
      id ${autoId},
      order_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      canteen_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      discount_type TEXT NOT NULL DEFAULT 'message',
      discount_value INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      starts_at TEXT,
      ends_at TEXT,
      FOREIGN KEY (canteen_id) REFERENCES canteens(id)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id ${autoId},
      order_id INTEGER,
      customer_id TEXT,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (customer_id) REFERENCES profiles(id)
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      profile_id TEXT PRIMARY KEY,
      dietary_preference TEXT,
      allergies TEXT NOT NULL DEFAULT '[]',
      favorite_categories TEXT NOT NULL DEFAULT '[]',
      budget_range TEXT,
      spice_preference TEXT,
      notification_preferences TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_canteen_created ON orders(canteen_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_token ON orders(token);
    CREATE INDEX IF NOT EXISTS idx_menu_items_canteen_category ON menu_items(canteen_id, category);
  `);
}

async function seed(db) {
  await db.run(
    'INSERT OR IGNORE INTO canteens (id, name, description, contact_phone, opening_hours, pickup_locations) VALUES (?, ?, ?, ?, ?, ?)',
    [DEFAULT_CANTEEN_ID, 'Student Union Cafe', 'Campus cafe for quick meals and pickup orders.', '+919876543210', '{"mon_fri":"08:00-19:00","sat":"10:00-16:00","sun":"closed"}', '["Table 12 (Main Floor)","Express Counter A","Cafe Patio Table 4","Student Library Booth"]']
  );
  await db.run(
    'INSERT OR IGNORE INTO profiles (id, auth_user_id, name, email, phone, role) VALUES (?, ?, ?, ?, ?, ?)',
    [DEFAULT_OWNER_ID, 'demo-owner', 'FoodQueue Owner', 'owner@foodqueue.local', '+919876543210', 'owner']
  );
  await db.run(
    'INSERT OR IGNORE INTO canteen_members (canteen_id, profile_id, role) VALUES (?, ?, ?)',
    [DEFAULT_CANTEEN_ID, DEFAULT_OWNER_ID, 'owner']
  );

  for (const [index, name] of CATEGORIES.entries()) {
    await db.run(
      'INSERT OR IGNORE INTO menu_categories (id, canteen_id, name, sort_order) VALUES (?, ?, ?, ?)',
      [`cat_${name.toLowerCase()}`, DEFAULT_CANTEEN_ID, name, index + 1]
    );
  }

  for (const item of MENU_SEED_DATA) {
    const [id, name, description, category, priceCents, imageUrl, stock, isAvailable, tags] = item;
    await db.run(
      `INSERT OR IGNORE INTO menu_items
       (id, canteen_id, category_id, name, description, category, price_cents, image_url, is_available, prep_time_minutes, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, DEFAULT_CANTEEN_ID, `cat_${category.toLowerCase()}`, name, description, category, priceCents, imageUrl, isAvailable, 15, tags]
    );
    await db.run(
      'INSERT OR IGNORE INTO inventory (menu_item_id, stock_quantity, low_stock_threshold) VALUES (?, ?, ?)',
      [id, stock, 5]
    );
  }

  await db.run(
    'INSERT OR IGNORE INTO offers (id, canteen_id, title, description, discount_type, discount_value, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['offer_campus_20', DEFAULT_CANTEEN_ID, 'Campus Student Discount', 'FLAT20 can be configured by the owner. Payment is still collected separately.', 'flat', 2000, 1]
  );
}

module.exports = {
  DEFAULT_CANTEEN_ID,
  DEFAULT_DATABASE_PATH,
  DEFAULT_OWNER_ID,
  MENU_SEED_DATA,
  initializeDatabase,
  uuid
};
