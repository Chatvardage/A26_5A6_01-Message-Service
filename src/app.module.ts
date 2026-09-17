import { Module } from "@nestjs/common";
import { JwtAuthService } from "./auth/jwt-auth.service";
import { HealthController } from "./health.controller";
import { MessagesModule } from "./messages/messages.module";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis.service";

@Module({
  imports: [MessagesModule],
  controllers: [HealthController],
  providers: [PrismaService, RedisService, JwtAuthService],
})
export class AppModule {}
