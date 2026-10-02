import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AiError, AiErrorCode } from '../../domain/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Catch()
export class AiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('AiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    if (
      exception instanceof HttpException &&
      request.url.startsWith('/health')
    ) {
      return reply.status(exception.getStatus()).send(exception.getResponse());
    }
    const error =
      exception instanceof AiError
        ? exception
        : new AiError(this.codeFor(exception));
    if (error.code === 'INTERNAL_ERROR')
      this.logger.error({
        errorClass: (exception as Error)?.constructor?.name,
      });
    const header = request.headers['x-request-id'];
    return reply.status(error.status).send({
      error: {
        code: error.code,
        message: error.message,
        requestId:
          typeof header === 'string' && UUID.test(header) ? header : null,
      },
    });
  }

  private codeFor(exception: unknown): AiErrorCode {
    const fastifyCode = (exception as { code?: string })?.code;
    if (fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE')
      return 'PAYLOAD_TOO_LARGE';
    // Nest converts Fastify parser errors to HttpException, dropping the Fastify code;
    // a 413 can only come from the bodyLimit enforcement above, so it stays PAYLOAD_TOO_LARGE.
    if (exception instanceof HttpException && exception.getStatus() === 413)
      return 'PAYLOAD_TOO_LARGE';
    if (
      fastifyCode?.startsWith('FST_ERR_CTP') ||
      (exception instanceof HttpException && exception.getStatus() < 500)
    ) {
      return 'INVALID_REQUEST';
    }
    return 'INTERNAL_ERROR';
  }
}
