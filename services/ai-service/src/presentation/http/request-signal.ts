declare module 'fastify' {
  interface FastifyRequest {
    aiSignal: AbortSignal;
    correlationId?: string;
  }
}

export {};
