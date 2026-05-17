/**
 * VULNERABLE EXAMPLE — DO NOT FIX
 * Intentional BOLA/IDOR bugs for testing RouteGuard detection.
 * Protected by .bobignore — Bob will not auto-modify this file.
 *
 * [VULN] = RouteGuard should flag
 * [SAFE] = RouteGuard should NOT flag
 */

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const app = express();
const prisma = new PrismaClient();

// [VULN] Any user can fetch any order — no ownership check
app.get('/orders/:id', async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
  });
  res.json(order);
});

// [VULN] Query param flows directly into DB — no ownership check
app.get('/invoices', async (req, res) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.query.invoiceId },
  });
  res.json(invoice);
});

// [VULN] Write without ownership verification
app.put('/documents/:docId', async (req, res) => {
  const doc = await prisma.document.update({
    where: { id: req.params.docId },
    data: req.body,
  });
  res.json(doc);
});

// [SAFE] Ownership check present
app.get('/orders/:id/secure', async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  res.json(order);
});

// [SAFE] No user-supplied ID — not a BOLA candidate
app.get('/products', async (_req, res) => {
  const products = await prisma.product.findMany();
  res.json(products);
});

app.listen(3000);
