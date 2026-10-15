function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'The requested API route was not found.'
    }
  });
}

function errorHandler(error, req, res, next) {
  const statusCode = error.statusCode || 500;
  const response = {
    error: {
      code: error.code || 'INTERNAL_SERVER_ERROR',
      message: statusCode === 500 ? 'An unexpected server error occurred.' : error.message
    }
  };

  if (error.details) {
    response.error.details = error.details;
  }

  if (statusCode === 500) {
    console.error(error);
  }

  res.status(statusCode).json(response);
}

module.exports = {
  errorHandler,
  notFoundHandler
};
