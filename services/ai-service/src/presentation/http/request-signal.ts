declare module 'fastify' {
  interface FastifyRequest {
    aiSignal: AbortSignal;
  }
}

export {};
