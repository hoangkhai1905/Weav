import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { AuthPolicy } from './auth/auth-policy.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @AuthPolicy('public')
  getHello(): string {
    return this.appService.getHello();
  }
}
