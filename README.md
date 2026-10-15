# FoodQueue — Smart Campus Café Ordering & Live Queue Management

FoodQueue is a full-stack campus café ordering and live kitchen queue management system developed for **SWYNEX Technologies**.

Task 4 represents the complete, production-ready implementation of FoodQueue. It transforms the original frontend and backend prototypes into an integrated, secure, multi-tenant application supporting both customer ordering and kitchen staff operations, while strictly preserving the recognizable original UI, typography, color palette, and interactions.

---

## Table of Contents
1. [Key Features](#key-features)
2. [Architecture & Technology Stack](#architecture--technology-stack)
3. [Project Structure](#project-structure)
4. [Prerequisites & Installation](#prerequisites--installation)
5. [Local Development Startup](#local-development-startup)
6. [Customer & Owner Dashboard User Guide](#customer--owner-dashboard-user-guide)
7. [Environment Configuration](#environment-configuration)
8. [Database Setup & Migrations](#database-setup--migrations)
9. [Authentication & Secure Owner Onboarding](#authentication--secure-owner-onboarding)
10. [Automated Testing & Syntax Checks](#automated-testing--syntax-checks)
11. [Screenshots Guidance](#screenshots-guidance)
12. [Deployment Architecture & Hosting Instructions](#deployment-architecture--hosting-instructions)
13. [Known Limitations](#known-limitations)

---

## Key Features

### Customer Experience (`index.html`)
- **Preserved UI & Design Identity**: Exact styling, typography (`Plus Jakarta Sans`, `Playfair Display`), colors (sage greens, cream surfaces, warm dark accents), cards, badges, and responsive layouts preserved from original designs.
- **Dynamic Menu & Category Filtering**: Browse live items across categories (*Burgers*, *Beverages*, *Bowls*, etc.) with live search and out-of-stock badges.
- **Interactive Cart & Checkout**: Real-time quantity adjustments, price calculations, pickup location selection, pickup time scheduling, and kitchen instructions.
- **Server-Authoritative Pricing & Totals**: Subtotal, 5% state tax, and order tokens (`#FQ-XXXX`) calculated strictly on the backend in integer cents.
- **Live Order Queue & Tracking**: Real-time tracking modal showing queue progress (`Order Placed` → `Kitchen Preparing` → `Ready for Pickup` → `Completed`) with clear status messaging and `✕` markers if an order is cancelled or rejected.
- **Customer Account & History Isolation**: Private customer order history, personal dietary and spice preferences, active canteen offers, and feedback submission.

### Owner & Kitchen Staff Operations (`owner.html`)
- **Live Kitchen Display Queue**: Auto-refreshing queue (20-second polling) displaying pending and active orders, pickup spots, and order items.
- **Safe Cash Payment Verification**: One-click physical cash payment verification (`✓ Verify & Mark Paid`). Electronic payments remain `pending` until verified by payment gateway webhooks.
- **Order Status Progression**: Advance orders safely through kitchen lifecycle stages.
- **Safe Order Cancellation / Rejection**: Completed orders are protected from cancellation; cancelled orders automatically and transactionally restore item stock and record audit entries in `inventory_movements`.
- **Menu & Inventory Management**: Add new items, update prices, descriptions, images, availability toggles, and live inventory stock counts.
- **Operational Analytics & Alerts**: Real-time gross sales, paid/unpaid revenue breakdown, best-selling dishes, and automated low-stock warnings.

---

## Architecture & Technology Stack

```
┌────────────────────────────────────────────────────────┐
│             Frontend (Static Hosting / CDN)            │
│  - Customer Interface: index.html + js/app.js          │
│  - Owner Kitchen Display: owner.html + js/owner.js     │
│  - Runtime Config: config.js (resilient fallback)      │
│  - Styling: css/style.css (100% original preserved)    │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS / REST API
┌───────────────────────────▼────────────────────────────┐
│              Backend Service (Node.js / Express 5)     │
│  - Server: src/server.js + src/app.js                  │
│  - Auth & Security: src/middleware/auth.js             │
│    * Supabase Asymmetric JWKS (RS256/ES256)            │
│    * Supabase Symmetric HMAC (HS256)                   │
│    * Strict CORS Origin Validation                     │
│    * Production Demo Auth Prohibition                  │
│  - Transaction Manager: src/db/database.js             │
│    * Leased client withTransaction (PostgreSQL)        │
│    * BEGIN IMMEDIATE (SQLite)                          │
└───────────────────────────┬────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│ Cloud Database (Supabase) │ │ Local / Dev / Test Engine │
│ - PostgreSQL 15+          │ │ - SQLite via node:sqlite  │
│ - Integer cents storage   │ │ - Auto-provisioned        │
│ - Multi-tenant canteens   │ │ - Auto-seeded on start    │
└───────────────────────────┘ └───────────────────────────┘
```

- **Frontend**: Vanilla JavaScript (ES2022+), CSS3 Variables, Semantic HTML5, Supabase JS client (via CDN).
- **Backend**: Node.js (>= 22.5), Express 5 (`^5.1.0`), `pg` (`^8.23.1`), `supertest`.
- **Database Engine**: Dual-engine persistence:
  - **Production**: Supabase PostgreSQL with pooled connections and dedicated leased clients for atomic transactions.
  - **Development / Testing**: SQLite via Node.js native `node:sqlite` (`DatabaseSync`), auto-seeded with default canteen and menu data.
- **Security**: Node.js built-in `crypto` for HMAC-SHA256, public key verification against Supabase JWKS endpoints, and constant-time string comparisons (`crypto.timingSafeEqual`).

---

## Project Structure

```text
SWYNEX-Task-4-Complete-Application/
├── frontend/
│   ├── index.html               # Customer web application
│   ├── owner.html               # Owner & kitchen display dashboard
│   ├── config.js                # Runtime API configuration (resilient, production-safe)
│   ├── config.example.js        # Example configuration template
│   ├── css/
│   │   └── style.css            # Preserved original FoodQueue design & layout
│   └── js/
│       ├── app.js               # Customer UI state, cart, ordering, tracking, auth
│       ├── data.js              # Fallback initial menu items & categories
│       └── owner.js             # Owner kitchen dashboard logic & analytics
├── backend/
│   ├── src/
│   │   ├── app.js               # Express application, routes, transactional handlers
│   │   ├── server.js            # HTTP server startup & graceful shutdown
│   │   ├── db/
│   │   │   └── database.js      # Dual PostgreSQL/SQLite database layer
│   │   └── middleware/
│   │       ├── auth.js          # Cryptographic JWT & role-based middleware
│   │       └── errorHandler.js  # Global error & 404 response handlers
│   ├── migrations/
│   │   └── 001_initial_supabase_schema.sql  # Supabase PostgreSQL schema & seeds
│   ├── archive/
│   │   └── task2_legacy/        # Archived legacy Task 2 modules (reference only)
│   ├── tests/
│   │   └── task4.test.js        # 18 automated integration tests
│   ├── package.json
│   └── .env.example             # Template for backend environment variables
├── .gitignore                   # Excludes databases, logs, secrets, and local overrides
└── README.md                    # Project documentation (this file)
```

---

## Prerequisites & Installation

### Requirements
- **Node.js**: Version 22.5.0 or higher (`node -v`).
- **Python** (optional, for local frontend serving): Python 3.x (`py -m http.server`) or any static file server.

### Installation Steps
```bash
# 1. Navigate to the backend directory
cd backend

# 2. Install dependencies
npm install
```

---

## Local Development Startup

### Step 1: Start the Backend API
```bash
cd backend
npm start
```
The backend initializes the local SQLite database at `backend/data/foodqueue.db` (auto-seeding 8 menu items, categories, and inventory) and listens on:
```text
http://localhost:3000
```

### Step 2: Serve the Frontend
From a separate terminal window:
```bash
cd frontend
py -m http.server 8080 --bind 127.0.0.1
```
*Alternatively, use `npx serve . -p 8080`.*

### Step 3: Access Applications
- **Customer Web Application**: [http://127.0.0.1:8080/](http://127.0.0.1:8080/)
- **Owner Kitchen Dashboard**: [http://127.0.0.1:8080/owner.html](http://127.0.0.1:8080/owner.html)

---

## Customer & Owner Dashboard User Guide

### Customer Flow (`index.html`)
1. **Browse & Filter**: Filter dishes by category pills (*All*, *Burgers*, *Beverages*, *Bowls*) or use the search bar.
2. **Add to Cart**: Click `+ Add` on menu cards. The floating bottom order bar reflects quantity and total amount.
3. **Checkout**: Click `View Order` / `Checkout`. Enter customer name, phone number, pickup location (*Table 12*, *Counter A*, etc.), pickup time, and payment method (*Cash*, *UPI*, *Card*).
4. **Order Confirmation & Tracking**: Receive a unique order token (e.g., `#FQ-8492`). Click `Track Order` to view live kitchen status.
5. **Account & History**: Click the top-right avatar icon to sign in or view order history, preferences, and offers.

### Owner Kitchen Flow (`owner.html`)
1. **Queue Monitor**: View incoming orders in real time. Orders display items, customer details, pickup spot, and payment status.
2. **Verify Cash**: For cash orders, click `✓ Verify & Mark Paid (Cash)` once cash is received.
3. **Advance Order**: Click `Advance Status` to step through `preparing` → `ready_for_pickup` → `completed`.
4. **Cancel / Reject**: If kitchen is out of ingredients or an order is invalid, click `Cancel / Reject`. The system restocks inventory automatically.
5. **Inventory Management**: Scroll to the Menu Management table to update item pricing, stock levels, and low-stock alert thresholds.
6. **Analytics**: Top KPI cards report gross sales, collected cash revenue, unpaid/pending volume, and low-stock warnings.

---

## Environment Configuration

### Backend (`backend/.env`)
Copy `backend/.env.example` to `backend/.env`:

```env
PORT=3000
NODE_ENV=development

# Database Configuration (leave empty for local SQLite)
DATABASE_URL=
PGSSL=require

# Supabase Auth Settings
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-public-anon-key
SUPABASE_JWT_SECRET=your-jwt-secret

# Owner Security Bootstrap Secret
OWNER_BOOTSTRAP_SECRET=super-secret-random-bootstrap-token

# Production CORS Allowed Origins (comma-separated, no wildcards)
CORS_ORIGINS=http://127.0.0.1:8080,http://localhost:8080

# Demo auth fallback (strictly blocked in production)
AUTH_MODE=demo
```

### Frontend (`frontend/config.js`)
`frontend/config.js` is committed with production-safe, resilient discovery logic:
- Automatically detects `localhost` and connects to `http://localhost:3000/api`.
- When deployed statically, connects to same-origin `/api` by default.
- Supports runtime override via URL query parameter: `?api=https://your-backend.onrender.com/api` (saved in browser `localStorage`).
- **Never store database credentials, service role keys, or signing secrets in frontend files.**

---

## Database Setup & Migrations

### Production: Supabase PostgreSQL
1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Navigate to **SQL Editor** in the Supabase Dashboard.
3. Paste and run the entire contents of:
   ```text
   backend/migrations/001_initial_supabase_schema.sql
   ```
4. Copy your PostgreSQL connection URI from **Project Settings → Database → Connection string → URI (Transaction Pooler or Direct)**.
5. Paste it into `DATABASE_URL` in your backend environment variables.

### Local Development: SQLite Auto-Seeding
When `DATABASE_URL` is unset or empty, the backend runs against SQLite. No manual migration execution is needed. On first boot, `backend/src/db/database.js` creates all required tables, foreign keys, indexes, and initial records automatically.

---

## Authentication & Secure Owner Onboarding

### Customer Authentication
- In development, the app supports instant demo login (`AUTH_MODE=demo`).
- In production, authentication uses Supabase Auth JWT tokens. The backend validates token signatures cryptographically (HS256 HMAC or RS256/ES256 JWKS) and checks `exp`, `nbf`, and `sub` claims.
- Customers registering through `POST /api/auth/profile` are permanently assigned `role = 'customer'`, preventing client-side privilege escalation.

### Secure Owner Bootstrap
To prevent unauthorized users from claiming owner privileges, the initial canteen owner is bootstrapped via a protected, single-purpose endpoint:
1. Register/sign in as a normal user via the application.
2. Send an authenticated `POST` request to `/api/auth/bootstrap-owner`:
   ```bash
   curl -X POST http://localhost:3000/api/auth/bootstrap-owner \
     -H "Authorization: Bearer <user_jwt_token>" \
     -H "Content-Type: application/json" \
     -d '{"bootstrapSecret": "YOUR_CONFIGURED_OWNER_BOOTSTRAP_SECRET"}'
   ```
3. The backend performs a timing-safe comparison (`crypto.timingSafeEqual`) against `process.env.OWNER_BOOTSTRAP_SECRET`. Upon match, the profile is promoted to `role = 'owner'` and assigned to the primary canteen.
4. Once the initial owner is bootstrapped, subsequent staff can be managed by the owner.

---

## Automated Testing & Syntax Checks

### Run All Backend Automated Tests
```bash
cd backend
npm test
```
*Or directly via Node test runner:*
```bash
node --test tests/task4.test.js
```

### Test Coverage Highlights (18 Tests)
- Menu querying with inventory stock counts and category listings.
- Server-side tax (5%), integer cents calculation, and token generation.
- Atomic inventory decrements and rollback on insufficient stock.
- Customer order isolation (users cannot access others' private orders).
- Cryptographic JWT validation (expired tokens rejected with `401 TOKEN_EXPIRED`, tampered signatures rejected with `401 INVALID_TOKEN`).
- Strict demo authentication prohibition in production mode (`401 DEMO_AUTH_DISABLED`).
- Secure owner bootstrap with constant-time secret comparison.
- Strict production CORS origin enforcement.
- Safe owner cash payment verification (`unpaid` → `paid`).
- Rejection of manual `paid` overrides on electronic payment orders (`400 INVALID_PAYMENT_ACTION`).
- Order cancellation and rejection with automatic inventory restock and `inventory_movements` audit logging.
- Prohibition of cancelling already `completed` orders (`400 INVALID_STATUS_TRANSITION`).
- Customer feedback validation (ratings 1–5, reviewer authorization).
- Active offers endpoint verification.

### Run Syntax Checks
```bash
node --check frontend/js/app.js
node --check frontend/js/owner.js
node --check backend/src/app.js
node --check backend/src/db/database.js
node --check backend/src/middleware/auth.js
node --check backend/src/middleware/errorHandler.js
```

---

## Screenshots Guidance

When capturing screenshots for project submission or documentation, capture the following key views:

1. **Customer Home & Menu (`index.html`)**:
   - Show category pills, search bar, hero banner, and menu cards with images, badges, and prices.
2. **Cart & Checkout Modal**:
   - Show selected items, student name/phone inputs, pickup location dropdown, pickup time, and calculated total with 5% tax.
3. **Order Confirmation & Live Queue Tracking**:
   - Capture the confirmation dialog displaying order token `#FQ-XXXX` and the 4-step live tracking timeline modal.
4. **Owner Kitchen Display Dashboard (`owner.html`)**:
   - Capture live orders in queue, `Advance Status` button, `✓ Verify & Mark Paid` button, and analytics summary cards.
5. **Menu & Stock Management**:
   - Show the owner menu inventory table with live stock quantities, low-stock alerts, and the add/edit item modal.
6. **Automated Test Results**:
   - Capture terminal output of `npm test` demonstrating all 18 integration tests passing with 0 failures.

---

## Deployment Architecture & Hosting Instructions

### 1. Database (Supabase)
1. Create a project at [supabase.com](https://supabase.com).
2. Execute `backend/migrations/001_initial_supabase_schema.sql` in the Supabase SQL Editor.
3. Obtain your PostgreSQL Connection URI from project database settings.

### 2. Backend (Render / Railway / Fly.io)
1. Connect your repository to the hosting platform.
2. Set root directory to `backend`.
3. Set build command: `npm install`.
4. Set start command: `node src/server.js`.
5. Set environment variables:
   - `NODE_ENV=production`
   - `PORT=3000` (or platform default `$PORT`)
   - `DATABASE_URL=<your-supabase-db-url>`
   - `PGSSL=require`
   - `SUPABASE_URL=https://<your-project>.supabase.co`
   - `SUPABASE_ANON_KEY=<your-anon-key>`
   - `SUPABASE_JWT_SECRET=<your-jwt-secret>`
   - `OWNER_BOOTSTRAP_SECRET=<your-random-secret>`
   - `CORS_ORIGINS=https://<your-frontend-domain>`

### 3. Frontend (Vercel / Netlify / GitHub Pages)
1. Deploy the `frontend/` directory to your static hosting provider.
2. Set the `API_BASE_URL` in `frontend/config.js` to your deployed backend URL:
   ```javascript
   window.FOODQUEUE_CONFIG = {
     API_BASE_URL: 'https://your-backend-api.onrender.com/api',
     SUPABASE_URL: 'https://your-project.supabase.co',
     SUPABASE_ANON_KEY: 'your-public-anon-key'
   };
   ```
   *(Or dynamically configure it in any browser session by appending `?api=https://your-backend-api.onrender.com/api` to the frontend URL).*

---

## Known Limitations

- **Payment Gateway Integration**: Live electronic payment gateways (e.g. Razorpay, Stripe) are not integrated in this milestone. Electronic orders (`upi`, `card`) are stored with `payment_status: 'pending'` and cannot be manually marked as paid by staff. Physical cash orders can be marked `paid` by staff upon cash verification.
- **Live Cloud Supabase Integration**: While PostgreSQL schema migrations (`001_initial_supabase_schema.sql`), table structures, and transactional connection pool logic were audited and tested with unit mocks, live integration against an active cloud Supabase project remains **unverified** because external production credentials were intentionally not configured in this local development environment.
- **WebSocket Push**: Order tracking and kitchen queue monitoring currently use optimized HTTP polling (20-second interval). True real-time WebSocket / SSE push can be introduced as a future enhancement.
- **Multi-Canteen UI Switching**: The backend schema and APIs are fully multi-tenant (`canteen_id` partition). The current frontend defaults to the primary campus canteen (`canteen_main`).
