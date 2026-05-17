/**
 * NestJS Framework Adapter
 *
 * Hardest adapter — build last. Key differences from Express/Fastify:
 * - Routes are class methods, not standalone functions
 * - Path split across @Controller (base) + @Get/@Post (method)
 * - Taint sources come from parameter decorators: @Param('id'), @Query('foo')
 * - Auth context from @Req() or custom @CurrentUser() decorators
 *
 * V1 scope limitation:
 *   Cross-class taint (this.service.method(id)) is NOT supported.
 *   In-controller analysis only. Document this clearly.
 *
 * TODO: implement after Fastify adapter is solid
 * Start by mapping NestJS controller AST in ast-explorer mode
 */

export {};
