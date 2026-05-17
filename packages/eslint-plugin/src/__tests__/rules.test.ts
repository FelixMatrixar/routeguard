/**
 * Per-rule RuleTester cases — Phase 8 exit criterion.
 *
 * 5 valid + 5 invalid per rule × 8 rules = 80 cases minimum.
 * Additional edge cases bring the total above 80.
 */

import { RuleTester } from 'eslint';
import { makeRule } from '../rules/make-rule';

const tester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
});

const EX  = `const express = require('express'); const app = express();`;
const FAX = `const fastify = require('fastify')();`;

// ─── helpers ──────────────────────────────────────────────────────────────────

function invalid(code: string, errors = 1) {
  return { code, errors };
}

// ─── no-bola ──────────────────────────────────────────────────────────────────

tester.run('routeguard/no-bola', makeRule('db-filter'), {
  valid: [
    // 1. Ownership field userId tied to auth context
    `${EX} app.get('/orders/:id', async (req, res) => {
       const o = await prisma.order.findFirst({ where: { id: req.params.id, userId: req.user.id } });
       res.json(o);
     });`,

    // 2. ownerId variant
    `${EX} app.get('/docs/:id', async (req, res) => {
       const d = await prisma.doc.findUnique({ where: { id: req.params.id, ownerId: req.user.id } });
       res.json(d);
     });`,

    // 3. authorId variant
    `${EX} app.get('/posts/:id', async (req, res) => {
       const p = await prisma.post.findFirst({ where: { id: req.params.id, authorId: req.user.id } });
       res.json(p);
     });`,

    // 4. No dynamic params — static query, nothing tainted
    `${EX} app.get('/products', async (_req, res) => {
       const all = await prisma.product.findMany();
       res.json(all);
     });`,

    // 5. Fastify with ownership check
    `${FAX} fastify.get('/orders/:id', async (request, reply) => {
       const { id } = request.params;
       const o = await prisma.order.findFirst({ where: { id, userId: request.user.id } });
       reply.send(o);
     });`,
  ],

  invalid: [
    // 1. findUnique — only tainted id, no ownership
    invalid(`${EX} app.get('/orders/:id', async (req, res) => {
       const o = await prisma.order.findUnique({ where: { id: req.params.id } });
       res.json(o);
     });`),

    // 2. findFirst with query param
    invalid(`${EX} app.get('/invoices', async (req, res) => {
       const i = await prisma.invoice.findFirst({ where: { id: req.query.invoiceId } });
       res.json(i);
     });`),

    // 3. delete — db-filter, no ownership
    invalid(`${EX} app.delete('/files/:id', async (req, res) => {
       await prisma.file.delete({ where: { id: req.params.id } });
       res.sendStatus(204);
     });`),

    // 4. Fastify without ownership
    invalid(`${FAX} fastify.get('/orders/:id', async (request, reply) => {
       const { id } = request.params;
       const o = await prisma.order.findUnique({ where: { id } });
       reply.send(o);
     });`),

    // 5. Variable intermediary
    invalid(`${EX} app.get('/items/:id', async (req, res) => {
       const id = req.params.id;
       const item = await prisma.item.findUnique({ where: { id } });
       res.json(item);
     });`),
  ],
});

// ─── no-mass-assignment ───────────────────────────────────────────────────────

tester.run('routeguard/no-mass-assignment', makeRule('db-write'), {
  valid: [
    // 1. Explicit fields only — no req.body reference at all
    `${EX} app.post('/users', async (_req, res) => {
       const user = await prisma.user.create({ data: { role: 'user', active: true } });
       res.json(user);
     });`,

    // 2. Data from process.env, not req
    `${EX} app.post('/config', async (_req, res) => {
       await prisma.config.create({ data: { key: 'timeout', value: process.env.TIMEOUT } });
       res.sendStatus(201);
     });`,

    // 3. No write operation at all
    `${EX} app.get('/users', async (_req, res) => {
       const users = await prisma.user.findMany();
       res.json(users);
     });`,

    // 4. Write uses literal values
    `${EX} app.post('/seed', async (_req, res) => {
       await prisma.tag.createMany({ data: [{ name: 'js' }, { name: 'ts' }] });
       res.sendStatus(201);
     });`,

    // 5. Fastify with no body taint
    `${FAX} fastify.post('/ping', async (_request, reply) => {
       await prisma.log.create({ data: { event: 'ping', ts: new Date().toISOString() } });
       reply.send({ ok: true });
     });`,
  ],

  invalid: [
    // 1. create with whole req.body
    invalid(`${EX} app.post('/users', async (req, res) => {
       const user = await prisma.user.create({ data: req.body });
       res.json(user);
     });`),

    // 2. update with whole req.body
    invalid(`${EX} app.put('/users/:id', async (req, res) => {
       const user = await prisma.user.update({ where: { id: req.params.id }, data: req.body });
       res.json(user);
     });`),

    // 3. Specific body field in data
    invalid(`${EX} app.post('/users', async (req, res) => {
       const user = await prisma.user.create({ data: { email: req.body.email, role: req.body.role } });
       res.json(user);
     });`),

    // 4. Fastify with req.body spread
    invalid(`${FAX} fastify.post('/users', async (request, reply) => {
       const user = await prisma.user.create({ data: request.body });
       reply.send(user);
     });`),

    // 5. createMany with whole body
    invalid(`${EX} app.post('/comments/bulk', async (req, res) => {
       await prisma.comment.createMany({ data: req.body });
       res.sendStatus(201);
     });`),
  ],
});

// ─── no-ssrf ──────────────────────────────────────────────────────────────────

tester.run('routeguard/no-ssrf', makeRule('outbound-url'), {
  valid: [
    // 1. URL is a string literal
    `${EX} app.get('/health', async (_req, res) => {
       const r = await axios.get('https://api.internal/ping');
       res.json(r.data);
     });`,

    // 2. URL from process.env
    `${EX} app.get('/meta', async (_req, res) => {
       const r = await axios.get(process.env.META_URL);
       res.json(r.data);
     });`,

    // 3. No outbound request
    `${EX} app.get('/items', async (_req, res) => {
       res.json({ ok: true });
     });`,

    // 4. Fetch with a constant
    `${EX} app.get('/data', async (_req, res) => {
       const BASE = 'https://api.example.com';
       const r = await fetch(BASE + '/v1/data');
       res.json(await r.json());
     });`,

    // 5. Fastify with literal URL
    `${FAX} fastify.get('/proxy', async (_request, reply) => {
       const r = await axios.get('https://safe.internal/data');
       reply.send(r.data);
     });`,
  ],

  invalid: [
    // 1. axios.get with query param URL
    invalid(`${EX} app.get('/proxy', async (req, res) => {
       const data = await axios.get(req.query.url);
       res.json(data);
     });`),

    // 2. fetch with route param
    invalid(`${EX} app.get('/fetch/:target', async (req, res) => {
       const r = await fetch(req.params.target);
       res.json(await r.json());
     });`),

    // 3. Variable intermediary
    invalid(`${EX} app.get('/fetch', async (req, res) => {
       const url = req.query.endpoint;
       const r = await axios.get(url);
       res.json(r.data);
     });`),

    // 4. Fastify with tainted URL
    invalid(`${FAX} fastify.get('/remote', async (request, reply) => {
       const r = await axios.get(request.query.url);
       reply.send(r.data);
     });`),

    // 5. got with tainted URL
    invalid(`${EX} app.post('/webhook', async (req, res) => {
       await got.post(req.body.callbackUrl, { json: { ok: true } });
       res.sendStatus(200);
     });`),
  ],
});

// ─── no-sql-injection ─────────────────────────────────────────────────────────

tester.run('routeguard/no-sql-injection', makeRule('raw-sql'), {
  valid: [
    // 1. Parameterized with ?
    `${EX} app.get('/users/:id', async (req, res) => {
       const rows = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
       res.json(rows);
     });`,

    // 2. Parameterized with $1
    `${EX} app.get('/users/:id', async (req, res) => {
       const rows = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
       res.json(rows);
     });`,

    // 3. Static query, no user input
    `${EX} app.get('/stats', async (_req, res) => {
       const rows = await db.query('SELECT COUNT(*) FROM users');
       res.json(rows);
     });`,

    // 4. No raw SQL at all
    `${EX} app.get('/items', async (_req, res) => {
       const items = await prisma.item.findMany();
       res.json(items);
     });`,

    // 5. Fastify with parameterized query
    `${FAX} fastify.get('/users/:id', async (request, reply) => {
       const rows = await db.query('SELECT * FROM users WHERE id = ?', [request.params.id]);
       reply.send(rows);
     });`,
  ],

  invalid: [
    // 1. Template literal in query
    invalid(`${EX} app.get('/search', async (req, res) => {
       const rows = await db.query(\`SELECT * FROM users WHERE name = '\${req.query.q}'\`);
       res.json(rows);
     });`),

    // 2. Route param interpolated
    invalid(`${EX} app.get('/users/:id', async (req, res) => {
       const rows = await db.query(\`SELECT * FROM users WHERE id = '\${req.params.id}'\`);
       res.json(rows);
     });`),

    // 3. pool.query with tainted template
    invalid(`${EX} app.get('/search', async (req, res) => {
       const rows = await pool.query(\`SELECT * FROM orders WHERE status = '\${req.query.status}'\`);
       res.json(rows);
     });`),

    // 4. Variable intermediary
    invalid(`${EX} app.get('/items', async (req, res) => {
       const q = req.query.filter;
       const rows = await db.query(\`SELECT * FROM items WHERE name = '\${q}'\`);
       res.json(rows);
     });`),

    // 5. Fastify with tainted template
    invalid(`${FAX} fastify.get('/search', async (request, reply) => {
       const rows = await db.query(\`SELECT * FROM products WHERE tag = '\${request.query.tag}'\`);
       reply.send(rows);
     });`),
  ],
});

// ─── no-command-injection ─────────────────────────────────────────────────────

tester.run('routeguard/no-command-injection', makeRule('shell-exec'), {
  valid: [
    // 1. execFile with args array — safe by design
    `${EX} const { execFile } = require('child_process');
     app.post('/convert', async (req, res) => {
       execFile('convert', [req.body.file, 'output.pdf'], () => {});
       res.sendStatus(200);
     });`,

    // 2. Static command, no user input
    `${EX} const { exec } = require('child_process');
     app.get('/version', (_req, res) => {
       exec('node --version', (err, out) => res.send(out));
     });`,

    // 3. No shell operations
    `${EX} app.get('/time', (_req, res) => {
       res.json({ ts: Date.now() });
     });`,

    // 4. spawn with static args
    `${EX} const { spawn } = require('child_process');
     app.get('/ls', (_req, res) => {
       const p = spawn('ls', ['-la', '/tmp']);
       p.stdout.pipe(res);
     });`,

    // 5. Fastify with static exec
    `${FAX} const { exec } = require('child_process');
     fastify.get('/uptime', (_request, reply) => {
       exec('uptime', (err, out) => reply.send(out));
     });`,
  ],

  invalid: [
    // 1. exec with template literal containing req.params
    invalid(`${EX} const { exec } = require('child_process');
     app.post('/convert', async (req, res) => {
       exec(\`convert \${req.body.file} output.pdf\`);
       res.end();
     });`),

    // 2. execSync with body field
    invalid(`${EX} const { execSync } = require('child_process');
     app.post('/run', (req, res) => {
       execSync(req.body.cmd);
       res.sendStatus(200);
     });`),

    // 3. spawn('sh', ['-c', tainted])
    invalid(`${EX} const { spawn } = require('child_process');
     app.post('/shell', (req, res) => {
       spawn('sh', ['-c', req.body.script]);
       res.end();
     });`),

    // 4. Fastify equivalent
    invalid(`${FAX} const { exec } = require('child_process');
     fastify.post('/convert', async (request, reply) => {
       exec(\`convert \${request.body.filename} output.pdf\`);
       reply.send({ ok: true });
     });`),

    // 5. Variable intermediary
    invalid(`${EX} const { exec } = require('child_process');
     app.post('/process', (req, res) => {
       const file = req.body.file;
       exec(\`process \${file}\`);
       res.end();
     });`),
  ],
});

// ─── no-path-traversal ────────────────────────────────────────────────────────

tester.run('routeguard/no-path-traversal', makeRule('fs-path'), {
  valid: [
    // 1. path.basename guards the input
    `${EX} const fs = require('fs'); const path = require('path');
     app.get('/download', (req, res) => {
       const safe = path.basename(req.query.file);
       fs.readFile(\`./uploads/\${safe}\`, (err, data) => res.send(data));
     });`,

    // 2. Static filename — no user input
    `${EX} const fs = require('fs');
     app.get('/readme', (_req, res) => {
       fs.readFile('./README.md', 'utf8', (err, data) => res.send(data));
     });`,

    // 3. No filesystem operations
    `${EX} app.get('/ping', (_req, res) => res.json({ ok: true }));`,

    // 4. File path from process.env
    `${EX} const fs = require('fs');
     app.get('/config', (_req, res) => {
       fs.readFile(process.env.CONFIG_PATH, 'utf8', (err, data) => res.send(data));
     });`,

    // 5. Fastify with basename guard
    `${FAX} const fs = require('fs'); const path = require('path');
     fastify.get('/file', (request, reply) => {
       const safe = path.basename(request.query.name);
       fs.readFile('./public/' + safe, (err, d) => reply.send(d));
     });`,
  ],

  invalid: [
    // 1. readFile with template literal
    invalid(`${EX} const fs = require('fs');
     app.get('/download', (req, res) => {
       fs.readFile(\`./uploads/\${req.query.file}\`, (err, data) => res.send(data));
     });`),

    // 2. writeFile with route param
    invalid(`${EX} const fs = require('fs');
     app.put('/files/:name', (req, res) => {
       fs.writeFile(\`./data/\${req.params.name}\`, req.body.content, () => res.sendStatus(200));
     });`),

    // 3. createReadStream with query param
    invalid(`${EX} const fs = require('fs');
     app.get('/stream', (req, res) => {
       fs.createReadStream('./uploads/' + req.query.file).pipe(res);
     });`),

    // 4. Fastify equivalent
    invalid(`${FAX} const fs = require('fs');
     fastify.get('/download', (request, reply) => {
       fs.readFile(\`./files/\${request.query.name}\`, (err, d) => reply.send(d));
     });`),

    // 5. Variable intermediary
    invalid(`${EX} const fs = require('fs');
     app.get('/fetch', (req, res) => {
       const name = req.query.filename;
       fs.readFile('./uploads/' + name, (err, d) => res.send(d));
     });`),
  ],
});

// ─── no-open-redirect ─────────────────────────────────────────────────────────

tester.run('routeguard/no-open-redirect', makeRule('redirect-url'), {
  valid: [
    // 1. Redirect to a string literal
    `${EX} app.get('/old', (_req, res) => {
       res.redirect('/new');
     });`,

    // 2. Redirect to a path derived from config
    `${EX} app.post('/logout', (_req, res) => {
       res.redirect(process.env.LOGOUT_REDIRECT || '/login');
     });`,

    // 3. No redirect at all
    `${EX} app.get('/items', (_req, res) => res.json([]));`,

    // 4. Redirect with static status code + literal URL
    `${EX} app.get('/moved', (_req, res) => {
       res.redirect(301, '/new-location');
     });`,

    // 5. Fastify with literal redirect
    `${FAX} fastify.get('/old', (_request, reply) => {
       reply.redirect('/new');
     });`,
  ],

  invalid: [
    // 1. res.redirect with query param
    invalid(`${EX} app.get('/go', (req, res) => {
       res.redirect(req.query.returnUrl);
     });`),

    // 2. res.redirect with status code overload
    invalid(`${EX} app.get('/bounce', (req, res) => {
       res.redirect(301, req.params.url);
     });`),

    // 3. Variable intermediary
    invalid(`${EX} app.get('/jump', (req, res) => {
       const dest = req.query.next;
       res.redirect(dest);
     });`),

    // 4. Fastify equivalent
    invalid(`${FAX} fastify.get('/go', (request, reply) => {
       reply.redirect(request.query.returnUrl);
     });`),

    // 5. Body param as redirect target
    invalid(`${EX} app.post('/login', (req, res) => {
       res.redirect(req.body.redirectTo);
     });`),
  ],
});

// ─── no-hardcoded-secrets ─────────────────────────────────────────────────────

tester.run('routeguard/no-hardcoded-secrets', makeRule('hardcoded-secret'), {
  valid: [
    // 1. JWT secret from env
    `${EX} const jwt = require('jsonwebtoken');
     app.post('/login', (req, res) => {
       const token = jwt.sign({ sub: 1 }, process.env.JWT_SECRET);
       res.json({ token });
     });`,

    // 2. createHmac with env secret
    `${EX} const crypto = require('crypto');
     app.get('/sign', (_req, res) => {
       const hmac = crypto.createHmac('sha256', process.env.HMAC_SECRET);
       res.json({ ok: true });
     });`,

    // 3. No crypto operations
    `${EX} app.get('/hello', (_req, res) => res.send('world'));`,

    // 4. jwt.verify with env secret
    `${EX} const jwt = require('jsonwebtoken');
     app.get('/me', (req, res) => {
       const payload = jwt.verify(req.headers.authorization, process.env.JWT_SECRET);
       res.json(payload);
     });`,

    // 5. Fastify with env secret
    `${FAX} const jwt = require('jsonwebtoken');
     fastify.post('/token', (_request, reply) => {
       const token = jwt.sign({ admin: true }, process.env.JWT_SECRET);
       reply.send({ token });
     });`,
  ],

  invalid: [
    // 1. jwt.sign with hardcoded string
    invalid(`${EX} const jwt = require('jsonwebtoken');
     app.post('/login', (req, res) => {
       const token = jwt.sign({ sub: 1 }, 'super-secret-signing-key');
       res.json({ token });
     });`),

    // 2. jwt.verify with hardcoded key
    invalid(`${EX} const jwt = require('jsonwebtoken');
     app.get('/me', (req, res) => {
       const p = jwt.verify(req.headers.auth, 'my-hardcoded-secret');
       res.json(p);
     });`),

    // 3. createHmac with hardcoded key
    invalid(`${EX} const crypto = require('crypto');
     app.get('/hash', (_req, res) => {
       const h = crypto.createHmac('sha256', 'hardcoded-hmac-key');
       res.json({ ok: true });
     });`),

    // 4. Variable named apiKey with literal value
    invalid(`${EX} app.get('/init', (_req, res) => {
       const apiKey = 'sk-prod-abc123456789xyz';
       res.json({ ok: true });
     });`),

    // 5. Fastify with hardcoded secret
    invalid(`${FAX} const jwt = require('jsonwebtoken');
     fastify.post('/auth', (_request, reply) => {
       const token = jwt.sign({ admin: true }, 'hardcoded-secret-key');
       reply.send({ token });
     });`),
  ],
});
