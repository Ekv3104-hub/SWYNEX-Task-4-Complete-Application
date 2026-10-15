async function findMenuItemsByIds(db, menuItemIds) {
  const uniqueIds = [...new Set(menuItemIds)];
  const placeholders = uniqueIds.map(() => '?').join(', ');

  return db.all(
    `SELECT id, name, description, category, price, image_url, is_available,
            prep_time_minutes, ingredients, allergens, tags
     FROM menu_items
     WHERE id IN (${placeholders})`,
    uniqueIds
  );
}

async function getAllMenuItems(db) {
  return db.all('SELECT * FROM menu_items ORDER BY id');
}

module.exports = {
  findMenuItemsByIds,
  getAllMenuItems
};
