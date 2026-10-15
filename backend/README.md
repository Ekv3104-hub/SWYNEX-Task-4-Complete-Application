# FoodQueue Backend (Task 4)

Production-ready backend API for the FoodQueue smart campus café ordering and live kitchen queue system.

Designed for SWYNEX Technologies, this backend supports multi-tenant campus canteens, dual-database persistence (Supabase PostgreSQL in cloud production with seamless local SQLite fallback), cryptographic JWT authentication, atomic order placement and inventory transactions, role-based access control, and owner kitchen operations.

---

## Architecture & Technology Stack

- **Runtime**: Node.js (>= 22.5)
- **Framework**: Express 5 (`^5.1.0`)
- **Database Architecture**:
  - **Production**: Supabase PostgreSQL via `pg` (`Pool` connection with leased client transactions).
  - **Development / Test / Offline**: Local SQLite via Node.js built-in `node:sqlite` (`DatabaseSync`), auto-seeded on first run.
- **Authentication**:
  - Supabase Auth JWT verification supporting symmetric (HS256 HMAC) and asymmetric (RS256 / ES256 via public JWKS).
  - Token claims validation (`exp`, `nbf`, `sub`).
  - Production enforcement: demo authentication tokens are strictly rejected when `NODE_ENV=production`.
- **Security & Authorization**:
  - Strict CORS origin validation rejecting wildcard origins in production.
  - Role-based access control (`customer`, `owner`, `staff`, `admin`).
  - Multi-tenant canteen boundary checks (`canteen_members`).
  - Customer order isolation (users can only access their own private orders and history).
  - Integer cents currency storage (`price_cents`, `subtotal_cents`, `tax_cents`, `total_cents`) to eliminate floating-point rounding errors.
  - Atomic transactions preventing negative inventory under race conditions.

---

## Directory Structure

```text
backend/
├── src/
│   ├── app.js               # Express application, routes, and business logic
│   ├── server.js            # HTTP server startup and graceful shutdown
│   ├── db/
│   │   └── database.js      # Dual-engine DB layer (PostgreSQL pool + SQLite adapter)
│   └── middleware/
│       ├── auth.js          # Cryptographic JWT & role-based access middleware
│       └── errorHandler.js  # Global error and 404 handlers
├── migrations/
│   └── 001_initial_supabase_schema.sql  # Supabase PostgreSQL schema & seed data
├── archive/
│   └── task2_legacy/        # Archived legacy Task 2 modules (for historical reference)
├── tests/
│   └── task4.test.js        # Comprehensive automated test suite
├── package.json
└── .env.example
```

---

## Prerequisites & Installation

### Requirements
- Node.js version 22.5.0 or higher.
- (Optional) Supabase project for PostgreSQL and Supabase Auth.

### Installation
```bash
cd backend
npm install
```

---

## Environment Variables

Copy `.env.example` to `.env` (or configure via platform environment settings):

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Port for the HTTP server to listen on. |
| `NODE_ENV` | No | `development` | Set to `production` in live deployments. Strictly disables demo authentication. |
| `DATABASE_URL` | No | *(empty)* | PostgreSQL connection string (e.g. Supabase connection pooler URL). If empty, falls back to local SQLite. |
| `PGSSL` | No | `require` | SSL mode for PostgreSQL connection. |
| `SUPABASE_URL` | Optional | *(empty)* | Supabase project URL (e.g., `https://xyz.supabase.co`). Required for JWKS asymmetric JWT verification. |
| `SUPABASE_ANON_KEY` | Optional | *(empty)* | Supabase public anonymous API key. |
| `SUPABASE_JWT_SECRET` | Optional | *(empty)* | Secret key for verifying HS256 JWT tokens issued by Supabase Auth. |
| `OWNER_BOOTSTRAP_SECRET` | Recommended | *(empty)* | Secret token used to securely promote the first canteen owner via `/api/auth/bootstrap-owner`. |
| `CORS_ORIGINS` | In Production | *(empty)* | Comma-separated list of allowed frontend origins (e.g. `https://foodqueue.vercel.app`). Wildcards (`*`) are disallowed. |
| `AUTH_MODE` | In Development | `demo` | Set to `demo` for offline local development without Supabase. Blocked in production. |

---

## Database Configuration & Migrations

### 1. Cloud Production (Supabase PostgreSQL)
1. In your Supabase dashboard, open the **SQL Editor**.
2. Run the SQL script from:
   ```text
   backend/migrations/001_initial_supabase_schema.sql
   ```
3. Set `DATABASE_URL` in your deployment environment variables to your Supabase PostgreSQL connection string (Transaction Pooler or Direct URI).

### 2. Local Development & Offline Mode (SQLite)
- If `DATABASE_URL` is omitted or empty, the backend automatically initializes a local SQLite database at:
  ```text
  backend/data/foodqueue.db
  ```
- All tables, constraints, default canteen (`canteen_main`), and 8 approved menu items with inventory records are automatically created and seeded on startup.

---

## Running the Backend

### Development Mode (with local SQLite)
```bash
npm start
```
The API starts on `http://localhost:3000`.

### Production Mode
```bash
NODE_ENV=production DATABASE_URL="postgresql://..." npm start
```

---

## API Reference

### Health & Public
- `GET /api/health` — Service health check and uptime.
- `GET /api/menu` — Fetch active menu items, stock status, and categories for a canteen (`?canteenId=...`).
- `GET /api/offers` — Fetch active canteen offers and discount promotions.

### Authentication & Profile
- `POST /api/auth/profile` — Upsert user profile (name, email, phone) upon registration/login. Customers cannot self-assign owner role.
- `POST /api/auth/bootstrap-owner` — Secure one-time bootstrap endpoint to promote an authenticated user to canteen `owner`. Requires `{ bootstrapSecret: "..." }` matching `OWNER_BOOTSTRAP_SECRET`.
- `GET /api/me` — Retrieve current user profile and dietary/ordering preferences (requires Bearer token).
- `PUT /api/me` — Update current user profile and preferences.

### Customer Ordering
- `POST /api/orders` — Place a new order with atomic inventory decrements. Calculates server-side subtotal, tax (5%), and total in integer cents.
- `GET /api/orders/:id` — Fetch order details and status. Registered customer orders are private to the purchaser and canteen owners.
- `GET /api/me/orders` — Fetch authenticated customer's order history.
- `POST /api/feedback` — Submit rating (1–5) and optional comment for a completed order.

### Owner Kitchen Display & Management
*(Requires `owner`, `staff`, or `admin` role for the canteen)*
- `GET /api/owner/summary` — Kitchen queue monitor: sales totals, unpaid balance, top sellers, and low-stock alerts.
- `GET /api/owner/canteen` — Fetch canteen details, operating hours, and pickup spots.
- `PUT /api/owner/canteen` — Update canteen settings.
- `GET /api/owner/menu` — Full menu management list including inactive and out-of-stock items.
- `POST /api/owner/menu` — Create a new menu item and initialize inventory.
- `PUT /api/owner/menu/:id` — Update menu item details, pricing, availability, and inventory stock.
- `PATCH /api/orders/:id/status` — Advance order status (`order_placed` → `preparing` → `ready_for_pickup` → `completed`), or cancel/reject (`cancelled`, `rejected`).
  - *Cancellation Safety*: Orders already marked `completed` cannot be cancelled. Cancellation automatically restores inventory in `inventory` and creates an audit entry in `inventory_movements`.
- `PATCH /api/orders/:id/payment` — Update payment status for cash orders (`unpaid` → `paid`).
  - *Electronic Payment Enforcement*: Electronic orders (`upi`, `card`) strictly reject manual `paid` overrides, remaining `pending` until verified by payment gateway webhooks.

---

## Automated Testing

The backend includes a comprehensive automated test suite testing concurrency, atomicity, authorization, JWT verification, and error handling.

To run the full test suite:
```bash
npm test
```
*Alternatively:*
```bash
node --test tests/task4.test.js
```
All tests run against isolated in-memory/temporary databases and do not affect live data.
 
---
 
## Limitations & Verification Status
 
- **Live Cloud Supabase Integration**: The PostgreSQL schema (`migrations/001_initial_supabase_schema.sql`) and dedicated client transaction handling (`pool.connect()`) were audited and verified via automated unit mocks, but live integration against an active cloud Supabase instance remains **unverified** because production credentials were intentionally not configured locally.
- **Payment Gateway**: Electronic payments (`upi`, `card`) remain `pending` by design until a live payment gateway webhook integration is configured. Physical cash payments can be marked `paid` by authorized canteen staff upon verification.
