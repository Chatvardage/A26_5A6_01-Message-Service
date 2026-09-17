import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("reports healthy dependencies", async () => {
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValue([1]) };
    const redis: any = { ping: jest.fn().mockResolvedValue("PONG") };
    const controller = new HealthController(prisma, redis);
    await expect(controller.health()).resolves.toEqual({
      status: "ok",
      service: "message-service",
      database: "ok",
      redis: "ok",
    });
  });

  it("reports a non-PONG Redis response as degraded", async () => {
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValue([1]) };
    const redis: any = { ping: jest.fn().mockResolvedValue("NOPE") };
    const controller = new HealthController(prisma, redis);
    await expect(controller.health()).resolves.toEqual({
      status: "degraded",
      service: "message-service",
      database: "ok",
      redis: "error",
    });
  });

  it("reports database failure independently", async () => {
    const prisma: any = {
      $queryRaw: jest.fn().mockRejectedValue(new Error("db")),
    };
    const redis: any = { ping: jest.fn().mockResolvedValue("PONG") };
    const controller = new HealthController(prisma, redis);
    await expect(controller.health()).resolves.toEqual({
      status: "degraded",
      service: "message-service",
      database: "error",
      redis: "ok",
    });
  });

  it("reports Redis failure independently", async () => {
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValue([1]) };
    const redis: any = {
      ping: jest.fn().mockRejectedValue(new Error("redis")),
    };
    const controller = new HealthController(prisma, redis);
    await expect(controller.health()).resolves.toEqual({
      status: "degraded",
      service: "message-service",
      database: "ok",
      redis: "error",
    });
  });
});
