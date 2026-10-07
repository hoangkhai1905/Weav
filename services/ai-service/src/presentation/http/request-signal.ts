declare module 'fastify' {
  interface FastifyRequest {
    /** Aborts on the request deadline or a client disconnect. */
    aiSignal: AbortSignal;
    /** Aborts only on the request deadline (not on a disconnect). */
    aiDeadline: AbortSignal;
    correlationId?: string;
  }
}

export {};
