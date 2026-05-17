/**
 * End-to-end tests for routeguard/detect-vulnerabilities.
 *
 * Exercises the full pipeline — parser → adapter → detectors → engine —
 * through ESLint's RuleTester. Each invalid case is a planted bug; each
 * valid case is a safe pattern that must produce zero findings.
 */

import { RuleTester } from 'eslint';
import { detectRule } from '../rules/detect';

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
});

const EXPRESS = `const express = require('express'); const app = express();`;

ruleTester.run('routeguard/detect-vulnerabilities', detectRule, {
  valid: [
    // Safe BOLA — ownership field tied to the authenticated user.
    `${EXPRESS}
     app.get('/orders/:id', async (req, res) => {
       const order = await prisma.order.findFirst({
         where: { id: req.params.id, userId: req.user.id },
       });
       res.json(order);
     });`,

    // Safe SQL — parameterized query.
    `${EXPRESS}
     app.get('/u/:id', async (req, res) => {
       const rows = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
       res.json(rows);
     });`,

    // No user-supplied input reaches the query.
    `${EXPRESS}
     app.get('/products', async (_req, res) => {
       const products = await prisma.product.findMany();
       res.json(products);
     });`,

    // Secret sourced from the environment, not a literal.
    `${EXPRESS}
     const jwt = require('jsonwebtoken');
     app.post('/login', (req, res) => {
       const token = jwt.sign({ sub: 1 }, process.env.JWT_SECRET);
       res.json({ token });
     });`,
  ],

  invalid: [
    // BOLA — tainted id with no ownership check.
    {
      code: `${EXPRESS}
       app.get('/orders/:id', async (req, res) => {
         const order = await prisma.order.findUnique({ where: { id: req.params.id } });
         res.json(order);
       });`,
      errors: 1,
    },

    // Mass assignment — whole request body written to the database.
    {
      code: `${EXPRESS}
       app.post('/users', async (req, res) => {
         const user = await prisma.user.create({ data: req.body });
         res.json(user);
       });`,
      errors: 1,
    },

    // SSRF — user-supplied URL reaches an outbound request.
    {
      code: `${EXPRESS}
       app.get('/proxy', async (req, res) => {
         const data = await axios.get(req.query.url);
         res.json(data);
       });`,
      errors: 1,
    },

    // SQL injection — tainted value interpolated into raw SQL.
    {
      code: `${EXPRESS}
       app.get('/search', async (req, res) => {
         const rows = await db.query(\`SELECT * FROM users WHERE name = '\${req.query.q}'\`);
         res.json(rows);
       });`,
      errors: 1,
    },

    // Command injection — tainted value reaches a shell.
    {
      code: `${EXPRESS}
       const cp = require('child_process');
       app.post('/convert', async (req, res) => {
         cp.exec(\`convert \${req.body.file} out.pdf\`);
         res.end();
       });`,
      errors: 1,
    },

    // Path traversal — tainted filename reaches the filesystem.
    {
      code: `${EXPRESS}
       const fs = require('fs');
       app.get('/download', async (req, res) => {
         fs.readFile(\`./uploads/\${req.query.file}\`, () => {});
         res.end();
       });`,
      errors: 1,
    },

    // Open redirect — tainted URL passed to res.redirect.
    {
      code: `${EXPRESS}
       app.get('/go', async (req, res) => {
         res.redirect(req.query.returnUrl);
       });`,
      errors: 1,
    },

    // Hardcoded secret — string literal used as a signing key.
    {
      code: `${EXPRESS}
       const jwt = require('jsonwebtoken');
       app.post('/login', (req, res) => {
         const token = jwt.sign({ sub: 1 }, 'super-secret-signing-key');
         res.json({ token });
       });`,
      errors: 1,
    },

    // Fastify — BOLA through the Fastify adapter.
    {
      code: `const fastify = require('fastify')();
       fastify.get('/orders/:id', async (request, reply) => {
         const { id } = request.params;
         const order = await prisma.order.findUnique({ where: { id } });
         reply.send(order);
       });`,
      errors: 1,
    },
  ],
});
