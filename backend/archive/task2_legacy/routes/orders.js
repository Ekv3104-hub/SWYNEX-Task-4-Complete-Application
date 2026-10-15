const express = require('express');
const { createOrderController } = require('../controllers/orderController');
const {
  validateCreateOrder,
  validateOrderStatus,
  validatePositiveId
} = require('../middleware/validation');

function createOrderRouter(db) {
  const router = express.Router();
  const controller = createOrderController(db);

  router.post('/orders', validateCreateOrder, controller.create);
  router.get('/orders/:id', validatePositiveId, controller.getById);
  router.get('/users/:userId/orders', validatePositiveId, controller.getByUserId);
  router.patch('/orders/:id/status', validatePositiveId, validateOrderStatus, controller.updateStatus);

  return router;
}

module.exports = {
  createOrderRouter
};
