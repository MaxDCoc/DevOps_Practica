import { Controller, Get } from '@nestjs/common';
import os from 'node:os';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', hostname: os.hostname() };
  }
}
