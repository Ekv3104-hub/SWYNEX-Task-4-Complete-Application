# Legacy Task 2 Modules Archive

These files were originally developed during Task 2 (Backend API and Database) and were copied during the initial Task 4 scaffold:

- `controllers/orderController.js`
- `models/menuItemModel.js`
- `models/orderModel.js`
- `models/userModel.js`
- `routes/orders.js`
- `middleware/validation.js`

### Why They Were Archived
In Task 4, the application architecture was upgraded to:
1. Support multi-tenant campus canteens (`canteens`, `canteen_members`).
2. Store currency values in integer cents (`subtotal_cents`, `tax_cents`, `total_cents`, `price_cents`) to prevent floating-point rounding errors.
3. Support Supabase PostgreSQL persistence as well as local SQLite via a unified database transaction abstraction (`withTransaction`).
4. Support cryptographic JWT authentication with Supabase JWKS/HS256 and role-based permissions (`owner`, `staff`, `customer`).
5. Support safe order cancellation/restocking and owner payment verification.

All active endpoints and business logic are implemented in `src/app.js`, `src/db/database.js`, `src/middleware/auth.js`, and `src/middleware/errorHandler.js`. These archived files are preserved here for historical reference and are not part of the active runtime.
