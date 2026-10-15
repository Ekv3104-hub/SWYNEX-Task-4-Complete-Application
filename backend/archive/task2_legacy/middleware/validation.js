const SUPPORTED_PAYMENT_METHODS = ['upi', 'card', 'cash'];
const ORDER_STATUSES = ['order_placed', 'preparing', 'ready_for_pickup', 'completed'];

function validationError(details) {
  const error = new Error('Request validation failed.');
  error.statusCode = 400;
  error.code = 'VALIDATION_ERROR';
  error.details = details;
  return error;
}

function normalizePhone(phone) {
  return phone.replace(/[\s-]/g, '');
}

function validateCreateOrder(req, res, next) {
  const body = req.body || {};
  const details = [];

  if (typeof body.customerName !== 'string' || body.customerName.trim() === '') {
    details.push({ field: 'customerName', message: 'customerName is required and must be a non-empty string.' });
  }

  if (typeof body.phone !== 'string' || body.phone.trim() === '') {
    details.push({ field: 'phone', message: 'phone is required.' });
  } else {
    const normalizedPhone = normalizePhone(body.phone);
    if (!/^\+?[1-9]\d{7,14}$/.test(normalizedPhone)) {
      details.push({ field: 'phone', message: 'phone must be a valid phone number.' });
    } else {
      body.phone = normalizedPhone;
    }
  }

  if (typeof body.pickupSpot !== 'string' || body.pickupSpot.trim() === '') {
    details.push({ field: 'pickupSpot', message: 'pickupSpot is required.' });
  }

  if (typeof body.pickupTime !== 'string' || body.pickupTime.trim() === '') {
    details.push({ field: 'pickupTime', message: 'pickupTime is required.' });
  }

  if (typeof body.paymentMethod !== 'string' || !SUPPORTED_PAYMENT_METHODS.includes(body.paymentMethod.toLowerCase())) {
    details.push({ field: 'paymentMethod', message: `paymentMethod must be one of: ${SUPPORTED_PAYMENT_METHODS.join(', ')}.` });
  } else {
    body.paymentMethod = body.paymentMethod.toLowerCase();
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    details.push({ field: 'items', message: 'items is required and must contain at least one item.' });
  } else {
    body.items.forEach((item, index) => {
      if (!item || typeof item.menuItemId !== 'string' || item.menuItemId.trim() === '') {
        details.push({ field: `items[${index}].menuItemId`, message: 'menuItemId is required.' });
      }
      if (!item || !Number.isInteger(item.quantity) || item.quantity <= 0) {
        details.push({ field: `items[${index}].quantity`, message: 'quantity is required and must be a positive integer.' });
      }
    });
  }

  if (body.userId !== undefined && (!Number.isInteger(body.userId) || body.userId <= 0)) {
    details.push({ field: 'userId', message: 'userId must be a positive integer when provided.' });
  }

  if (details.length > 0) {
    return next(validationError(details));
  }

  body.customerName = body.customerName.trim();
  body.pickupSpot = body.pickupSpot.trim();
  body.pickupTime = body.pickupTime.trim();
  return next();
}

function validateOrderStatus(req, res, next) {
  const { status } = req.body || {};
  if (typeof status !== 'string' || !ORDER_STATUSES.includes(status)) {
    return next(validationError([{
      field: 'status',
      message: `status must be one of: ${ORDER_STATUSES.join(', ')}.`
    }]));
  }
  return next();
}

function validatePositiveId(req, res, next) {
  const id = Number(req.params.id || req.params.userId);
  if (!Number.isInteger(id) || id <= 0) {
    return next(validationError([{ field: 'id', message: 'ID must be a positive integer.' }]));
  }
  return next();
}

module.exports = {
  ORDER_STATUSES,
  SUPPORTED_PAYMENT_METHODS,
  validateCreateOrder,
  validateOrderStatus,
  validatePositiveId,
  validationError
};
