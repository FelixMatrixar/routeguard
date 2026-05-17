# Detection Rules Reference

This document provides detailed specifications for all 8 deterministic detection rules in RouteGuard.

## Table of Contents

1. [no-bola](#1-no-bola) — Broken Object Level Authorization
2. [no-mass-assignment](#2-no-mass-assignment) — Mass Assignment
3. [no-ssrf](#3-no-ssrf) — Server-Side Request Forgery
4. [no-sql-injection](#4-no-sql-injection) — SQL Injection
5. [no-command-injection](#5-no-command-injection) — Command Injection
6. [no-path-traversal](#6-no-path-traversal) — Path Traversal
7. [no-open-redirect](#7-no-open-redirect) — Open Redirect
8. [no-hardcoded-secrets](#8-no-hardcoded-secrets) — Hardcoded Secrets

---

## 1. no-bola

### What it detects

Detects **Broken Object Level Authorization (BOLA/IDOR)** vulnerabilities where a user can access resources they don't own by manipulating IDs in the request.

**OWASP**: API1:2023 — Broken Object Level Authorization  
**CWE**: CWE-639 — Authorization Bypass Through User-Controlled Key

### Three-condition model

A BOLA vulnerability exists when ALL THREE conditions are met:

1. **Source**: User-controlled ID enters the handler (route param, query param, or body field)
2. **Sink**: That ID reaches a database filter clause (WHERE, findUnique, etc.)
3. **Guard**: The filter does NOT include an ownership field tied to the authenticated user

### Vulnerable code examples

#### Example 1: Prisma with route param

```typescript
app.get('/orders/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  
  // ❌ VULNERABLE: Any authenticated user can access any order
  const order = await prisma.order.findUnique({
    where: { id }
  });
  
  res.json(order);
});
```

**Why vulnerable**: The `id` comes from `req.params` (user-controlled), but the query doesn't verify that `req.user.id` owns the order.

#### Example 2: Drizzle with query param

```typescript
app.get('/documents', authenticate, async (req, res) => {
  const { documentId } = req.query;
  
  // ❌ VULNERABLE: User can access any document by changing documentId
  const doc = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  
  res.json(doc);
});
```

**Why vulnerable**: The `documentId` comes from `req.query` (user-controlled), but there's no check that the document belongs to the authenticated user.

### Safe code examples

#### Example 1: With ownership check

```typescript
app.get('/orders/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  
  // ✅ SAFE: Query includes userId ownership check
  const order = await prisma.order.findUnique({
    where: {
      id,
      userId: req.user.id  // ← Ownership check
    }
  });
  
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  
  res.json(order);
});
```

**Why safe**: The query includes `userId: req.user.id`, ensuring the user can only access their own orders.

#### Example 2: With explicit authorization check

```typescript
app.get('/orders/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  
  const order = await prisma.order.findUnique({
    where: { id }
  });
  
  // ✅ SAFE: Explicit authorization check before returning data
  if (!order || order.userId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  res.json(order);
});
```

**Why safe**: Even though the initial query doesn't include the ownership check, there's an explicit authorization check before returning the data.

**Note**: RouteGuard V1 only detects the first pattern (ownership in query). The second pattern requires control flow analysis (planned for V2).

### Known false positives

#### 1. Admin routes

```typescript
app.get('/admin/orders/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  // This will trigger a finding, but it's safe because requireAdmin
  // ensures only admins can access this route
  const order = await prisma.order.findUnique({
    where: { id }
  });
  
  res.json(order);
});
```

**Workaround**: Use `// eslint-disable-next-line routeguard/no-bola` with a comment explaining why it's safe.

#### 2. Public resources

```typescript
app.get('/posts/:id', async (req, res) => {
  const { id } = req.params;
  
  // This will trigger a finding, but posts are public
  const post = await prisma.post.findUnique({
    where: { id }
  });
  
  res.json(post);
});
```

**Workaround**: Configure `ignoreRoutes` in ESLint settings to exclude public routes, or use `// eslint-disable-next-line`.

### Known false negatives

#### 1. Indirect ownership

```typescript
app.get('/orders/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  
  // False negative: Ownership check is on related model
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: true
    }
  });
  
  // Ownership check happens here, but RouteGuard doesn't see it
  if (order.customer.userId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  res.json(order);
});
```

**Why missed**: RouteGuard V1 only checks the immediate filter clause, not related models or post-query checks.

**Rationale**: Detecting this would require understanding the database schema and relationship semantics, which is out of scope for V1.

### Configuration options

```typescript
settings: {
  routeguard: {
    // Fields that indicate ownership
    ownershipFields: ['userId', 'ownerId', 'tenantId', 'organizationId'],
    
    // Auth context configuration
    authContext: {
      property: 'user',  // req.user
      idField: 'id'      // req.user.id
    },
    
    // Severity level
    severity: 'error',  // or 'warning'
  }
}
```

---

## 2. no-mass-assignment

### What it detects

Detects **Mass Assignment** vulnerabilities where untrusted user input is directly passed to database write operations, allowing users to modify fields they shouldn't have access to.

**OWASP**: API3:2023 — Broken Object Property Level Authorization  
**CWE**: CWE-915 — Improperly Controlled Modification of Dynamically-Determined Object Attributes

### Three-condition model

A mass assignment vulnerability exists when ALL THREE conditions are met:

1. **Source**: User-controlled data from request body enters the handler
2. **Sink**: That data reaches a database write operation (update, create, upsert)
3. **Guard**: No explicit field allowlist is used (entire `req.body` is spread)

### Vulnerable code examples

#### Example 1: Prisma update with entire body

```typescript
app.patch('/users/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  
  // ❌ VULNERABLE: User can modify ANY field, including isAdmin, role, etc.
  const user = await prisma.user.update({
    where: { id, userId: req.user.id },
    data: req.body  // ← Entire body is passed
  });
  
  res.json(user);
});
```

**Why vulnerable**: If the request body contains `{ isAdmin: true }`, the user can elevate their privileges.

#### Example 2: TypeORM save with spread

```typescript
app.post('/profiles', authenticate, async (req, res) => {
  const profile = new Profile();
  
  // ❌ VULNERABLE: User can set ANY property on the profile
  Object.assign(profile, req.body);
  
  await profileRepository.save(profile);
  res.json(profile);
});
```

**Why vulnerable**: `Object.assign(profile, req.body)` copies all properties from the request body, including potentially sensitive fields.

### Safe code examples

#### Example 1: Explicit field allowlist

```typescript
app.patch('/users/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  
  // ✅ SAFE: Only allowed fields are extracted
  const { name, email, bio } = req.body;
  
  const user = await prisma.user.update({
    where: { id, userId: req.user.id },
    data: { name, email, bio }  // ← Explicit fields only
  });
  
  res.json(user);
});
```

**Why safe**: Only `name`, `email`, and `bio` can be modified. Fields like `isAdmin` or `role` are not included.

#### Example 2: Validation library with schema

```typescript
import { z } from 'zod';

const updateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  bio: z.string().max(500).optional(),
});

app.patch('/users/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  
  // ✅ SAFE: Schema validation ensures only allowed fields
  const validatedData = updateUserSchema.parse(req.body);
  
  const user = await prisma.user.update({
    where: { id, userId: req.user.id },
    data: validatedData
  });
  
  res.json(user);
});
```

**Why safe**: Zod schema acts as an allowlist. Any extra fields in `req.body` are stripped out.

### Known false positives

#### 1. DTO classes with decorators

```typescript
import { IsString, IsEmail } from 'class-validator';

class UpdateUserDto {
  @IsString()
  name: string;
  
  @IsEmail()
  email: string;
}

app.patch('/users/:id', authenticate, async (req, res) => {
  const dto = plainToClass(UpdateUserDto, req.body);
  await validate(dto);
  
  // This will trigger a finding, but class-validator ensures only
  // decorated fields are present
  const user = await prisma.user.update({
    where: { id: req.params.id, userId: req.user.id },
    data: dto
  });
  
  res.json(user);
});
```

**Workaround**: Use `// eslint-disable-next-line routeguard/no-mass-assignment` with a comment explaining the DTO validation.

### Known false negatives

#### 1. Nested object spread

```typescript
app.patch('/users/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { profile } = req.body;
  
  // False negative: profile object is spread without validation
  const user = await prisma.user.update({
    where: { id, userId: req.user.id },
    data: {
      profile: {
        update: profile  // ← Nested spread not detected
      }
    }
  });
  
  res.json(user);
});
```

**Why missed**: RouteGuard V1 only checks top-level data fields, not nested objects.

**Rationale**: Detecting nested spreads requires deep object traversal and understanding of ORM relationship semantics, which is complex and error-prone.

### Configuration options

```typescript
settings: {
  routeguard: {
    severity: 'error',  // or 'warning'
  }
}
```

---

## 3. no-ssrf

### What it detects

Detects **Server-Side Request Forgery (SSRF)** vulnerabilities where user-controlled URLs are used in outbound HTTP requests, allowing attackers to access internal services or perform port scanning.

**OWASP**: API7:2023 — Server Side Request Forgery  
**CWE**: CWE-918 — Server-Side Request Forgery

### Three-condition model

An SSRF vulnerability exists when ALL THREE conditions are met:

1. **Source**: User-controlled URL enters the handler (query param, body field, or route param)
2. **Sink**: That URL reaches an outbound HTTP request (axios, fetch, http.get, etc.)
3. **Guard**: No URL allowlist validation is performed

### Vulnerable code examples

#### Example 1: Axios with query param

```typescript
app.get('/proxy', async (req, res) => {
  const { url } = req.query;
  
  // ❌ VULNERABLE: User can make the server request any URL
  const response = await axios.get(url);
  
  res.json(response.data);
});
```

**Why vulnerable**: User can set `url=http://localhost:6379/` to access internal Redis, or `url=http://169.254.169.254/latest/meta-data/` to access cloud metadata.

#### Example 2: Fetch with body field

```typescript
app.post('/webhook', async (req, res) => {
  const { callbackUrl } = req.body;
  
  // ❌ VULNERABLE: User controls the callback URL
  await fetch(callbackUrl, {
    method: 'POST',
    body: JSON.stringify({ status: 'completed' })
  });
  
  res.json({ success: true });
});
```

**Why vulnerable**: User can set `callbackUrl` to internal services, cloud metadata endpoints, or use it for port scanning.

### Safe code examples

#### Example 1: URL allowlist

```typescript
const ALLOWED_DOMAINS = [
  'api.example.com',
  'webhook.example.com',
];

app.get('/proxy', async (req, res) => {
  const { url } = req.query;
  
  // ✅ SAFE: Validate against allowlist
  const parsedUrl = new URL(url);
  if (!ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
    return res.status(400).json({ error: 'Invalid domain' });
  }
  
  const response = await axios.get(url);
  res.json(response.data);
});
```

**Why safe**: Only URLs from allowed domains can be requested.

#### Example 2: Predefined endpoints

```typescript
const WEBHOOK_ENDPOINTS = {
  stripe: 'https://api.stripe.com/v1/webhooks',
  slack: 'https://hooks.slack.com/services',
};

app.post('/webhook', async (req, res) => {
  const { provider } = req.body;
  
  // ✅ SAFE: User selects from predefined endpoints
  const webhookUrl = WEBHOOK_ENDPOINTS[provider];
  if (!webhookUrl) {
    return res.status(400).json({ error: 'Invalid provider' });
  }
  
  await fetch(webhookUrl, {
    method: 'POST',
    body: JSON.stringify({ status: 'completed' })
  });
  
  res.json({ success: true });
});
```

**Why safe**: User can only select from predefined endpoints, not provide arbitrary URLs.

### Known false positives

None documented. SSRF detection is straightforward: if a tainted URL reaches an HTTP client, it's flagged.

### Known false negatives

#### 1. URL constructed from multiple parts

```typescript
app.get('/api-proxy', async (req, res) => {
  const { endpoint } = req.query;
  
  // False negative: URL is constructed, not directly from user input
  const url = `https://api.example.com/${endpoint}`;
  
  const response = await axios.get(url);
  res.json(response.data);
});
```

**Why missed**: RouteGuard V1 only detects direct taint flow. Template literals that construct URLs are not analyzed.

**Rationale**: Detecting constructed URLs requires string analysis and understanding of URL semantics, which is complex. V2 may support this with improved taint tracking.

### Configuration options

```typescript
settings: {
  routeguard: {
    severity: 'error',  // or 'warning'
  }
}
```

---

## 4. no-sql-injection

### What it detects

Detects **SQL Injection** vulnerabilities where user-controlled input is concatenated into raw SQL queries, allowing attackers to execute arbitrary SQL commands.

**CWE**: CWE-89 — SQL Injection

### Three-condition model

An SQL injection vulnerability exists when ALL THREE conditions are met:

1. **Source**: User-controlled input enters the handler
2. **Sink**: That input reaches a raw SQL query (template literal, string concatenation, or unsafe tagged template)
3. **Guard**: Query is not parameterized (no prepared statement)

### Vulnerable code examples

#### Example 1: Template literal

```typescript
app.get('/users', async (req, res) => {
  const { search } = req.query;
  
  // ❌ VULNERABLE: SQL injection via template literal
  const users = await db.query(`
    SELECT * FROM users WHERE name LIKE '%${search}%'
  `);
  
  res.json(users);
});
```

**Why vulnerable**: If `search = "'; DROP TABLE users; --"`, the query becomes:
```sql
SELECT * FROM users WHERE name LIKE '%'; DROP TABLE users; --%'
```

#### Example 2: String concatenation

```typescript
app.get('/orders/:id', async (req, res) => {
  const { id } = req.params;
  
  // ❌ VULNERABLE: SQL injection via string concatenation
  const query = 'SELECT * FROM orders WHERE id = ' + id;
  const orders = await db.query(query);
  
  res.json(orders);
});
```

**Why vulnerable**: If `id = "1 OR 1=1"`, the query returns all orders.

### Safe code examples

#### Example 1: Parameterized query

```typescript
app.get('/users', async (req, res) => {
  const { search } = req.query;
  
  // ✅ SAFE: Parameterized query
  const users = await db.query(
    'SELECT * FROM users WHERE name LIKE $1',
    [`%${search}%`]
  );
  
  res.json(users);
});
```

**Why safe**: The database driver escapes the parameter, preventing SQL injection.

#### Example 2: Safe tagged template

```typescript
import { sql } from 'kysely';

app.get('/users', async (req, res) => {
  const { search } = req.query;
  
  // ✅ SAFE: kysely's sql tag automatically parameterizes
  const users = await db
    .selectFrom('users')
    .selectAll()
    .where('name', 'like', sql`%${search}%`)
    .execute();
  
  res.json(users);
});
```

**Why safe**: Kysely's `sql` tag function automatically parameterizes the query.

### Known false positives

#### 1. Safe tagged templates

```typescript
import { sql } from 'some-safe-library';

app.get('/users', async (req, res) => {
  const { search } = req.query;
  
  // This will trigger a finding if 'sql' is not in SAFE_SQL_TAGS
  const users = await db.query(sql`
    SELECT * FROM users WHERE name LIKE ${search}
  `);
  
  res.json(users);
});
```

**Workaround**: Add the tag function name to `SAFE_SQL_TAGS` in `packages/orms/raw-sql/src/index.ts`.

### Known false negatives

#### 1. String concatenation flagged as unanalyzable

```typescript
app.get('/orders/:id', async (req, res) => {
  const { id } = req.params;
  
  // V1 flags this as "unanalyzable" but doesn't report it as SQL injection
  const query = 'SELECT * FROM orders WHERE id = ' + id;
  const orders = await db.query(query);
  
  res.json(orders);
});
```

**Why missed**: V1 detects string concatenation but doesn't parse the SQL to confirm it's an injection point.

**Rationale**: Parsing SQL strings requires a full SQL parser (e.g., `node-sql-parser`), which is a large dependency. V2 will include this.

### Configuration options

```typescript
settings: {
  routeguard: {
    severity: 'error',  // or 'warning'
  }
}
```

---

## 5. no-command-injection

### What it detects

Detects **Command Injection** vulnerabilities where user-controlled input is passed to shell commands, allowing attackers to execute arbitrary system commands.

**CWE**: CWE-78 — OS Command Injection

### Three-condition model

A command injection vulnerability exists when ALL THREE conditions are met:

1. **Source**: User-controlled input enters the handler
2. **Sink**: That input reaches a shell execution function (exec, spawn with shell:true, etc.)
3. **Guard**: Input is not sanitized or validated

### Vulnerable code examples

#### Example 1: exec with template literal

```typescript
import { exec } from 'child_process';

app.post('/convert', async (req, res) => {
  const { filename } = req.body;
  
  // ❌ VULNERABLE: Command injection via template literal
  exec(`convert ${filename} output.pdf`, (error, stdout) => {
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });
});
```

**Why vulnerable**: If `filename = "input.jpg; rm -rf /"`, the command becomes:
```bash
convert input.jpg; rm -rf / output.pdf
```

#### Example 2: spawn with shell:true

```typescript
import { spawn } from 'child_process';

app.post('/backup', async (req, res) => {
  const { path } = req.body;
  
  // ❌ VULNERABLE: shell:true enables command injection
  const child = spawn(`tar -czf backup.tar.gz ${path}`, {
    shell: true
  });
  
  res.json({ success: true });
});
```

**Why vulnerable**: `shell:true` enables shell interpretation, allowing command injection.

### Safe code examples

#### Example 1: execFile with args array

```typescript
import { execFile } from 'child_process';

app.post('/convert', async (req, res) => {
  const { filename } = req.body;
  
  // ✅ SAFE: execFile with args array (no shell)
  execFile('convert', [filename, 'output.pdf'], (error, stdout) => {
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });
});
```

**Why safe**: `execFile` does not invoke a shell, and arguments are passed as an array, preventing injection.

#### Example 2: Input validation

```typescript
import { exec } from 'child_process';

app.post('/convert', async (req, res) => {
  const { filename } = req.body;
  
  // ✅ SAFE: Strict validation before execution
  if (!/^[a-zA-Z0-9_-]+\.(jpg|png|gif)$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  
  exec(`convert ${filename} output.pdf`, (error, stdout) => {
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });
});
```

**Why safe**: Strict regex validation ensures only safe filenames are accepted.

**Note**: RouteGuard V1 does not detect this pattern (validation before sink). It will still flag the exec call.

### Known false positives

#### 1. Validated input

See Example 2 in safe code above. RouteGuard V1 will flag this even though validation is present.

**Workaround**: Use `// eslint-disable-next-line routeguard/no-command-injection` with a comment explaining the validation.

### Known false negatives

None documented. Command injection detection is straightforward.

### Configuration options

```typescript
settings: {
  routeguard: {
    severity: 'error',  // or 'warning'
  }
}
```

---

## 6. no-path-traversal

### What it detects

Detects **Path Traversal** vulnerabilities where user-controlled input is used in filesystem operations, allowing attackers to access files outside the intended directory.

**CWE**: CWE-22 — Path Traversal

### Three-condition model

A path traversal vulnerability exists when ALL THREE conditions are met:

1. **Source**: User-controlled input enters the handler (typically a filename or path)
2. **Sink**: That input reaches a filesystem operation (fs.readFile, fs.writeFile, etc.)
3. **Guard**: No path.basename() or path normalization is used

### Vulnerable code examples

#### Example 1: fs.readFile with template literal

```typescript
import fs from 'fs/promises';

app.get('/files/:filename', async (req, res) => {
  const { filename } = req.params;
  
  // ❌ VULNERABLE: Path traversal via filename
  const content = await fs.readFile(`./uploads/${filename}`, 'utf-8');
  
  res.send(content);
});
```

**Why vulnerable**: If `filename = "../../../etc/passwd"`, the path becomes `./uploads/../../../etc/passwd`, which resolves to `/etc/passwd`.

#### Example 2: fs.writeFile with query param

```typescript
import fs from 'fs/promises';

app.post('/save', async (req, res) => {
  const { filename } = req.query;
  const { content } = req.body;
  
  // ❌ VULNERABLE: Can write to any file on the system
  await fs.writeFile(`./data/${filename}`, content);
  
  res.json({ success: true });
});
```

**Why vulnerable**: If `filename = "../../../tmp/malicious.sh"`, the attacker can write files outside the intended directory.

### Safe code examples

#### Example 1: path.basename()

```typescript
import fs from 'fs/promises';
import path from 'path';

app.get('/files/:filename', async (req, res) => {
  const { filename } = req.params;
  
  // ✅ SAFE: path.basename() strips directory components
  const safeName = path.basename(filename);
  const content = await fs.readFile(`./uploads/${safeName}`, 'utf-8');
  
  res.send(content);
});
```

**Why safe**: `path.basename("../../../etc/passwd")` returns `"passwd"`, preventing traversal.

#### Example 2: Allowlist validation

```typescript
import fs from 'fs/promises';

const ALLOWED_FILES = ['report.pdf', 'invoice.pdf', 'receipt.pdf'];

app.get('/files/:filename', async (req, res) => {
  const { filename } = req.params;
  
  // ✅ SAFE: Only allowed files can be accessed
  if (!ALLOWED_FILES.includes(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  
  const content = await fs.readFile(`./uploads/${filename}`, 'utf-8');
  res.send(content);
});
```

**Why safe**: Only files in the allowlist can be accessed.

### Known false positives

#### 1. Validated paths

```typescript
import fs from 'fs/promises';
import path from 'path';

app.get('/files/:filename', async (req, res) => {
  const { filename } = req.params;
  
  // Validation present, but RouteGuard will still flag this
  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  
  const content = await fs.readFile(`./uploads/${filename}`, 'utf-8');
  res.send(content);
});
```

**Workaround**: Use `// eslint-disable-next-line routeguard/no-path-traversal` with a comment explaining the validation.

### Known false negatives

None documented. Path traversal detection is straightforward.

### Configuration options

```typescript
settings: {
  routeguard: {
    severity: 'error',  // or 'warning'
  }
}
```

---

## 7. no-open-redirect

### What it detects

Detects **Open Redirect** vulnerabilities where user-controlled URLs are used in redirect responses, allowing attackers to redirect users to malicious sites for phishing attacks.

**CWE**: CWE-601 — URL Redirection to Untrusted Site

### Three-condition model

An open redirect vulnerability exists when ALL THREE conditions are met:

1. **Source**: User-controlled URL enters the handler (query param or body field)
2. **Sink**: That URL reaches a redirect function (res.redirect, res.location, etc.)
3. **Guard**: No URL allowlist validation is performed

### Vulnerable code examples

#### Example 1: Express redirect with query param

```typescript
app.get('/logout', (req, res) => {
  const { returnUrl } = req.query;
  
  // Clear session
  req.session.destroy();
  
  // ❌ VULNERABLE: User controls redirect destination
  res.redirect(returnUrl || '/');
});
```

**Why vulnerable**: Attacker can set `returnUrl=https://evil.com/phishing` to redirect users to a phishing site.

#### Example 2: NestJS redirect with body field

```typescript
@Post('login')
async login(@Body() body: LoginDto, @Res() res: Response) {
  const user = await this.authService.validateUser(body.email, body.password);
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // ❌ VULNERABLE: Redirect URL from request body
  res.redirect(body.redirectUrl || '/dashboard');
}
```

**Why vulnerable**: Attacker can include `redirectUrl` in the login request to redirect users after successful authentication.

### Safe code examples

#### Example 1: URL allowlist

```typescript
const ALLOWED_REDIRECTS = [
  '/dashboard',
  '/profile',
  '/settings',
];

app.get('/logout', (req, res) => {
  const { returnUrl } = req.query;
  
  req.session.destroy();
  
  // ✅ SAFE: Only allowed URLs can be used
  if (returnUrl && ALLOWED_REDIRECTS.includes(returnUrl)) {
    res.redirect(returnUrl);
  } else {
    res.redirect('/');
  }
});
```

**Why safe**: Only URLs in the allowlist can be used for redirection.

#### Example 2: Relative path validation

```typescript
app.get('/logout', (req, res) => {
  const { returnUrl } = req.query;
  
  req.session.destroy();
  
  // ✅ SAFE: Only relative paths (starting with /) are allowed
  if (returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//')) {
    res.redirect(returnUrl);
  } else {
    res.redirect('/');
  }
});
```

**Why safe**: Only relative paths are allowed, preventing redirection to external sites.

**Note**: This check must also reject `//evil.com` which is a protocol-relative URL.

### Known false positives

None documented. Open redirect detection is straightforward.

### Known false negatives

#### 1. Indirect redirects

```typescript
app.get('/logout', (req, res) => {
  const { returnUrl } = req.query;
  
  req.session.destroy();
  
  // False negative: Redirect URL is stored and used later
  req.session.pendingRedirect = returnUrl;
  res.redirect('/logout-confirm');
});

app.get('/logout-confirm', (req, res) => {
  const redirectUrl = req.session.pendingRedirect;
  delete req.session.pendingRedirect;
  
  // This redirect is not detected because the taint flow is broken
  res.redirect(redirectUrl || '/');
});
```

**Why missed**: RouteGuard V1 only tracks taint within a single route handler, not across multiple requests.

**Rationale**: Cross-request taint tracking requires session analysis and understanding of application state, which is out of scope for V1.

### Configuration options

```typescript
settings: {
  routeguard: {
    severity: 'error',  // or 'warning'
  }
}
```

---

## 8. no-hardcoded-secrets

### What it detects

Detects **Hardcoded Secrets** where string literals (not environment variables) are used in cryptographic operations, JWT signing, or API authentication.

**CWE**: CWE-798 — Use of Hard-coded Credentials

### Three-condition model

A hardcoded secret vulnerability exists when ALL THREE conditions are met:

1. **Source**: A string literal is present in the code
2. **Sink**: That literal reaches a cryptographic function (jwt.sign, crypto.createHmac, etc.)
3. **Guard**: The value is not loaded from environment variables (process.env.X)

### Vulnerable code examples

#### Example 1: JWT with hardcoded secret

```typescript
import jwt from 'jsonwebtoken';

app.post('/login', async (req, res) => {
  const user = await validateCredentials(req.body);
  
  // ❌ VULNERABLE: Hardcoded JWT secret
  const token = jwt.sign(
    { userId: user.id },
    'my-super-secret-key',  // ← Hardcoded
    { expiresIn: '1h' }
  );
  
  res.json({ token });
});
```

**Why vulnerable**: The secret is visible in source code and version control. Anyone with access to the code can forge JWTs.

#### Example 2: Crypto with hardcoded key

```typescript
import crypto from 'crypto';

app.post('/encrypt', (req, res) => {
  const { data } = req.body;
  
  // ❌ VULNERABLE: Hardcoded encryption key
  const cipher = crypto.createCipher('aes-256-cbc', 'hardcoded-key-123');
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  res.json({ encrypted });
});
```

**Why vulnerable**: The encryption key is hardcoded, making all encrypted data vulnerable if the source code is leaked.

### Safe code examples

#### Example 1: Environment variable

```typescript
import jwt from 'jsonwebtoken';

app.post('/login', async (req, res) => {
  const user = await validateCredentials(req.body);
  
  // ✅ SAFE: Secret loaded from environment variable
  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET,  // ← From environment
    { expiresIn: '1h' }
  );
  
  res.json({ token });
});
```

**Why safe**: The secret is stored in environment variables (`.env` file), not in source code.

#### Example 2: Config module

```typescript
import jwt from 'jsonwebtoken';
import config from './config';  // Loads from process.env

app.post('/login', async (req, res) => {
  const user = await validateCredentials(req.body);
  
  // ✅ SAFE: Secret loaded via config module
  const token = jwt.sign(
    { userId: user.id },
    config.jwtSecret,  // ← From config (which loads from env)
    { expiresIn: '1h' }
  );
  
  res.json({ token });
});
```

**Why safe**: The config module loads secrets from environment variables.

**Note**: RouteGuard V1 may flag this if it cannot trace that `config.jwtSecret` comes from `process.env`. Use `// eslint-disable-next-line` if needed.

### Known false positives

#### 1. Test/development secrets

```typescript
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-for-testing';

app.post('/login', async (req, res) => {
  const user = await validateCredentials(req.body);
  
  // This will trigger a finding because of the fallback literal
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
  
  res.json({ token });
});
```

**Workaround**: Remove the fallback literal and fail fast if `JWT_SECRET` is not set:
```typescript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
```

#### 2. Public keys

```typescript
import jwt from 'jsonwebtoken';

// This will trigger a finding, but it's a public key (not secret)
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
-----END PUBLIC KEY-----`;

app.get('/verify', (req, res) => {
  const { token } = req.query;
  
  try {
    const decoded = jwt.verify(token, PUBLIC_KEY);
    res.json({ valid: true, decoded });
  } catch (error) {
    res.status(401).json({ valid: false });
  }
});
```

**Workaround**: Use `// eslint-disable-next-line routeguard/no-hardcoded-secrets` with a comment explaining it's a public key.

### Known false negatives

#### 1. Secrets loaded from config files

```typescript
import config from './config.json';  // { "jwtSecret": "hardcoded-in-json" }

app.post('/login', async (req, res) => {
  const user = await validateCredentials(req.body);
  
  // False negative: Secret is hardcoded in config.json, not detected
  const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '1h' });
  
  res.json({ token });
});
```

**Why missed**: RouteGuard V1 only detects string literals in the analyzed file, not in imported JSON/YAML config files.

**Rationale**: Analyzing imported files requires a full module resolution system and understanding of various config formats, which is out of scope for V1.

### Configuration options

```typescript
settings: {
  routeguard: {
    severity: 'warning',  // Often set to 'warning' instead of 'error'
  }
}
```

---

**Made with Bob** 🤖