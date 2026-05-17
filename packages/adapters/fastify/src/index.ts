/**
 * Fastify Framework Adapter
 *
 * Follows Express adapter pattern. Key differences:
 * - `request` not `req` (but configurable)
 * - fastify.route({ method, url, handler }) object form
 * - Auth often in preHandler hooks (v1: handler scope only)
 *
 * TODO: implement after Express adapter is solid
 */

export {};
