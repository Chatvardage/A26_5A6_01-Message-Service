import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async health(): Promise<Record<string, string>> {
    let database = 'ok';
    let redis = 'ok';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }
    try {
      if ((await this.redis.ping()) !== 'PONG') redis = 'error';
    } catch {
      redis = 'error';
    }

    const result = {
      status: database === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      service: 'message-service',
      database,
      redis,
    };

    if (result.status === 'degraded') {
      throw new ServiceUnavailableException(result);
    }

    return result;
  }
}
