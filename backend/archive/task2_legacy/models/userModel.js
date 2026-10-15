async function findUserById(db, userId) {
  return db.get('SELECT id, name, email, phone, role, created_at, updated_at FROM users WHERE id = ?', userId);
}

async function createUser(db, user) {
  const result = await db.run(
    'INSERT INTO users (name, email, phone, role) VALUES (?, ?, ?, ?)',
    user.name,
    user.email || null,
    user.phone || null,
    user.role || 'student'
  );

  return findUserById(db, result.lastID);
}

module.exports = {
  createUser,
  findUserById
};
