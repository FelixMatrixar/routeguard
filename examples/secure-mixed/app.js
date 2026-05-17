/**
 * SECURE EXAMPLE — must always produce ZERO RouteGuard findings.
 * Every route here uses a safe pattern. If RouteGuard flags anything in
 * this file, that is a false positive and a regression.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

// SAFE: ownership check ties the row to the authenticated user
app.get('/orders/:id', async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  res.json(order);
});

// SAFE: no user-supplied input reaches the query
app.get('/products', async (_req, res) => {
  const products = await prisma.product.findMany();
  res.json(products);
});

// SAFE: parameterized SQL — value passed as a bound parameter
app.get('/users/:id', async (req, res) => {
  const rows = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  res.json(rows);
});

// SAFE: path.basename strips traversal sequences before the fs call
app.get('/files/:name', async (req, res) => {
  const safeName = path.basename(req.params.name);
  fs.readFile(path.join('./uploads', safeName), () => {});
  res.end();
});

// SAFE: signing secret comes from the environment, not a literal
app.post('/login', (req, res) => {
  const token = jwt.sign({ sub: 1 }, process.env.JWT_SECRET);
  res.json({ token });
});

app.listen(3000);
