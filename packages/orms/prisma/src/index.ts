/**
 * Prisma ORM Adapter — Reference Implementation
 *
 * Detects Prisma query calls and converts WHERE clauses to Sink IR.
 *
 * Supported: findUnique, findFirst, findMany, update, updateMany,
 *            delete, deleteMany, upsert
 * Nested where: AND/OR arrays
 * Out of scope (v1): $queryRaw (→ raw-sql adapter), $transaction
 *
 * AST shape for `prisma.order.findUnique({ where: { id } })`:
 *   CallExpression
 *     callee: MemberExpression
 *       object: MemberExpression        ← prisma.order
 *         object: Identifier(prisma)
 *         property: Identifier(order)   ← model name
 *       property: Identifier(findUnique)
 *     arguments[0]: ObjectExpression    ← { where: { ... } }
 *
 * TODO: implement — use ast-explorer mode in Bob
 */

export {};
