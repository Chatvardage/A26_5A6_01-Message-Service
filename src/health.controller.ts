import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async health(): Promise<Record<string, string>> {
    await this.prisma.$queryRaw`SELECT 1`;
    const redis = await this.redis.ping();
    return {
      status: "ok",
      service: "message-service",
      database: "ok",
      redis: redis === "PONG" ? "ok" : "error",
    };
  }
}
