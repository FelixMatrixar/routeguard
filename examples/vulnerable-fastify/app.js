/**
 * VULNERABLE EXAMPLE — DO NOT FIX
 * Intentional vulnerabilities for testing RouteGuard's Fastify adapter.
 * Protected by .bobignore.
 *
 * [VULN] = RouteGuard should flag
 * [SAFE] = RouteGuard should NOT flag
 */

const fastify = require('fastify')();
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const prisma = new PrismaClient();

// [VULN] BOLA — any user can read any order, no ownership check
fastify.get('/orders/:id', async (request, reply) => {
  const { id } = request.params;
  const order = await prisma.order.findUnique({ where: { id } });
  reply.send(order);
});

// [VULN] SSRF — user-supplied URL flows straight into an outbound request
fastify.get('/proxy', async (request, reply) => {
  const data = await axios.get(request.query.url);
  reply.send(data);
});

// [VULN] BOLA via the fastify.route({}) object form
fastify.route({
  method: 'DELETE',
  url: '/invoices/:id',
  handler: async (request, reply) => {
    await prisma.invoice.delete({ where: { id: request.params.id } });
    reply.send({ ok: true });
  },
});

// [SAFE] ownership check ties the row to the authenticated user
fastify.get('/orders/:id/secure', async (request, reply) => {
  const order = await prisma.order.findFirst({
    where: { id: request.params.id, userId: request.user.id },
  });
  reply.send(order);
});

fastify.listen({ port: 3000 });
