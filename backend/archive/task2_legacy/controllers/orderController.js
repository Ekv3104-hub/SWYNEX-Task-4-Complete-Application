const { findMenuItemsByIds } = require('../models/menuItemModel');
const { findUserById } = require('../models/userModel');
const {
  createOrder,
  getOrderById,
  getOrdersByUserId,
  updateOrderStatus
} = require('../models/orderModel');
const { ORDER_STATUSES, validationError } = require('../middleware/validation');

function notFound(resource) {
  const error = new Error(`${resource} was not found.`);
  error.statusCode = 404;
  error.code = 'NOT_FOUND';
  return error;
}

function createOrderController(db) {
  return {
    async create(req, res, next) {
      try {
        const { userId, items } = req.body;

        if (userId !== undefined && !(await findUserById(db, userId))) {
          return next(notFound('User'));
        }

        const menuItems = await findMenuItemsByIds(db, items.map((item) => item.menuItemId));
        const menuItemsById = new Map(menuItems.map((item) => [item.id, item]));
        const invalidItems = [];

        for (const item of items) {
          const menuItem = menuItemsById.get(item.menuItemId);
          if (!menuItem) {
            invalidItems.push({ field: 'menuItemId', value: item.menuItemId, message: 'menuItemId must refer to a valid menu item.' });
          } else if (!menuItem.is_available) {
            invalidItems.push({ field: 'menuItemId', value: item.menuItemId, message: 'menuItemId must refer to an available menu item.' });
          }
        }

        if (invalidItems.length > 0) {
          return next(validationError(invalidItems));
        }

        const order = await createOrder(db, req.body, menuItemsById);
        return res.status(201).json({ order });
      } catch (error) {
        return next(error);
      }
    },

    async getById(req, res, next) {
      try {
        const order = await getOrderById(db, Number(req.params.id));
        if (!order) {
          return next(notFound('Order'));
        }
        return res.json({ order });
      } catch (error) {
        return next(error);
      }
    },

    async getByUserId(req, res, next) {
      try {
        const userId = Number(req.params.userId);
        if (!(await findUserById(db, userId))) {
          return next(notFound('User'));
        }
        const orders = await getOrdersByUserId(db, userId);
        return res.json({ orders });
      } catch (error) {
        return next(error);
      }
    },

    async updateStatus(req, res, next) {
      try {
        const order = await getOrderById(db, Number(req.params.id));
        if (!order) {
          return next(notFound('Order'));
        }

        const currentStatusIndex = ORDER_STATUSES.indexOf(order.status);
        const requestedStatusIndex = ORDER_STATUSES.indexOf(req.body.status);
        if (requestedStatusIndex !== currentStatusIndex + 1) {
          const error = new Error(`Order status must move to the next stage: ${ORDER_STATUSES[currentStatusIndex + 1] || 'no further stage'}.`);
          error.statusCode = 400;
          error.code = 'INVALID_STATUS_TRANSITION';
          return next(error);
        }

        const updatedOrder = await updateOrderStatus(db, order.id, req.body.status);
        return res.json({ order: updatedOrder });
      } catch (error) {
        return next(error);
      }
    }
  };
}

module.exports = {
  createOrderController
};
