// FILE: server.js
// Run: node server.js

const express = require('express');
const bodyParser = require('body-parser');
const productsRouter = require('./routes/products');
const logger = require('./middleware/logger');
const { authMiddleware } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json()); // JSON parsing middleware
app.use(logger); // custom logger
app.use('/api', authMiddleware); // simple API-key auth for /api routes

// Routes
app.get('/', (req, res) => res.send('Hello World'));
app.use('/api/products', productsRouter);

// Global error handler
app.use(errorHandler);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ------------------------------------------------------------
// FILE: routes/products.js

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('../utils/asyncHandler');
const { validateProduct } = require('../middleware/validate');
const { NotFoundError } = require('../errors');

// In-memory products store (replace with DB in real app)
let products = [
  { id: uuidv4(), name: 'Laptop', description: 'A fast laptop', price: 1200, category: 'electronics', inStock: true },
  { id: uuidv4(), name: 'Coffee Mug', description: 'Ceramic mug', price: 8.5, category: 'home', inStock: true },
  { id: uuidv4(), name: 'Notebook', description: '200 pages', price: 3, category: 'stationery', inStock: false }
];

// GET /api/products - list with pagination & filtering
// Query params: page, limit, category
router.get('/', asyncHandler(async (req, res) => {
  let { page = 1, limit = 10, category, search } = req.query;
  page = parseInt(page);
  limit = parseInt(limit);

  let results = products.slice();

  if (category) {
    results = results.filter(p => p.category.toLowerCase() === category.toLowerCase());
  }

  if (search) {
    const q = search.toLowerCase();
    results = results.filter(p => p.name.toLowerCase().includes(q));
  }

  const total = results.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  const paginated = results.slice(start, end);

  res.json({ page, limit, total, data: paginated });
}));

// GET /api/products/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const product = products.find(p => p.id === req.params.id);
  if (!product) throw new NotFoundError('Product not found');
  res.json(product);
}));

// POST /api/products
router.post('/', validateProduct, asyncHandler(async (req, res) => {
  const { name, description, price, category, inStock } = req.body;
  const newProduct = { id: uuidv4(), name, description, price, category, inStock };
  products.push(newProduct);
  res.status(201).json(newProduct);
}));

// PUT /api/products/:id
router.put('/:id', validateProduct, asyncHandler(async (req, res) => {
  const idx = products.findIndex(p => p.id === req.params.id);
  if (idx === -1) throw new NotFoundError('Product not found');
  const { name, description, price, category, inStock } = req.body;
  const updated = { ...products[idx], name, description, price, category, inStock };
  products[idx] = updated;
  res.json(updated);
}));

// DELETE /api/products/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const idx = products.findIndex(p => p.id === req.params.id);
  if (idx === -1) throw new NotFoundError('Product not found');
  const deleted = products.splice(idx, 1)[0];
  res.json({ message: 'Deleted', product: deleted });
}));

// GET /api/products/stats - count by category
router.get('/stats/category', asyncHandler(async (req, res) => {
  const counts = products.reduce((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1;
    return acc;
  }, {});
  res.json({ total: products.length, counts });
}));

module.exports = router;

// ------------------------------------------------------------
// FILE: middleware/logger.js

module.exports = function logger(req, res, next) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.originalUrl}`);
  next();
};

// ------------------------------------------------------------
// FILE: middleware/auth.js

const API_KEY = process.env.API_KEY || 'changeme';

function authMiddleware(req, res, next) {
  // Allow root
  if (req.path === '/' || req.path === '') return next();

  const key = req.header('x-api-key') || req.query.api_key;
  if (!key || key !== API_KEY) {
    const err = new Error('Unauthorized: invalid API key');
    err.status = 401;
    return next(err);
  }
  next();
}

module.exports = { authMiddleware };

// ------------------------------------------------------------
// FILE: middleware/validate.js

const { ValidationError } = require('../errors');

function validateProduct(req, res, next) {
  const { name, description, price, category, inStock } = req.body;
  const errors = [];

  if (typeof name !== 'string' || name.trim().length < 1) errors.push('name is required');
  if (typeof description !== 'string') errors.push('description must be a string');
  if (typeof price !== 'number' || Number.isNaN(price) || price < 0) errors.push('price must be a non-negative number');
  if (typeof category !== 'string' || category.trim().length < 1) errors.push('category is required');
  if (typeof inStock !== 'boolean') errors.push('inStock must be a boolean');

  if (errors.length) return next(new ValidationError(errors.join(', ')));
  next();
}

module.exports = { validateProduct };

// ------------------------------------------------------------
// FILE: middleware/errorHandler.js

const { isCustomError } = require('../errors');

function errorHandler(err, req, res, next) {
  console.error(err);
  if (isCustomError(err)) {
    return res.status(err.statusCode || err.status || 400).json({ error: err.message });
  }

  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal Server Error' });
}

module.exports = { errorHandler };

// ------------------------------------------------------------
// FILE: errors.js

class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Not Found') {
    super(message, 404);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation Error') {
    super(message, 422);
  }
}

function isCustomError(err) {
  return err && err.isOperational;
}

module.exports = { AppError, NotFoundError, ValidationError, isCustomError };

// ------------------------------------------------------------
// FILE: utils/asyncHandler.js

// Small helper to catch async errors and forward to next()
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ------------------------------------------------------------
// FILE: README.md

# Express Products API - Starter

A simple Express.js RESTful API for managing products. Features:

- CRUD routes for products
- Custom logger middleware
- API key authentication middleware
- Validation middleware
- Global error handling with custom error classes
- Filtering, pagination, search
- Product statistics endpoint

## Quick start

1. Clone your repo and copy the files into the project folder.
2. Install dependencies:

```
npm init -y
npm install express body-parser uuid
```

3. (Optional) set environment variables. See `.env.example`.

4. Run:

```
node server.js
```

The API listens on port 3000 by default.

## Endpoints

- `GET /` - Hello World
- `GET /api/products` - list products (query: `page`, `limit`, `category`, `search`)
- `GET /api/products/:id` - get product
- `POST /api/products` - create product (JSON body)
- `PUT /api/products/:id` - update product (JSON body)
- `DELETE /api/products/:id` - delete product
- `GET /api/products/stats/category` - statistics by category

**Authentication**: provide header `x-api-key: <key>` or query `?api_key=<key>`.

## Example product JSON

```json
{
  "name": "Phone",
  "description": "Smartphone",
  "price": 499.99,
  "category": "electronics",
  "inStock": true
}
```

## Notes

- This starter uses an in-memory store. For production, swap with a database.
- Validation is intentionally simple; consider using Joi or express-validator for complex rules.

// ------------------------------------------------------------
// FILE: .env.example

PORT=3000
API_KEY=changeme

// ------------------------------------------------------------
// END OF FILES
