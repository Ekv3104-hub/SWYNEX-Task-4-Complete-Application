const { createApp } = require('./app');
const { initializeDatabase } = require('./db/database');

const port = Number(process.env.PORT) || 3000;

async function startServer() {
  const db = await initializeDatabase();
  const app = createApp(db);
  const server = app.listen(port, () => {
    console.log(`FoodQueue API is running on http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(() => db.close());
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer().catch((error) => {
  console.error('FoodQueue API could not start.', error);
  process.exitCode = 1;
});
