import { Controller, Param, Post, Req, Res } from '@nestjs/common';
import { OcrService } from './ocr.service';

export interface FastifyReply {
  header(key: string, value: any): this;
  status(statusCode: number): this;
  send(payload?: any): any;
}

export interface FastifyRequest {
  headers: Record<string, any>;
  body?: any;
  raw?: any;
}

@Controller('api/v1/workspaces/:workspaceId/ocr')
export class OcrController {
  constructor(private readonly ocrService: OcrService) {}

  @Post('extractions')
  async proxyExtraction(
    @Param('workspaceId') workspaceId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<any> {
    const result = await this.ocrService.proxyExtraction(workspaceId, req);

    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        const lower = key.toLowerCase();
        if (
          value !== undefined &&
          lower !== 'content-length' &&
          lower !== 'transfer-encoding' &&
          lower !== 'connection'
        ) {
          reply.header(key, value);
        }
      }
    }

    return reply.status(result.status).send(result.data);
  }
}
