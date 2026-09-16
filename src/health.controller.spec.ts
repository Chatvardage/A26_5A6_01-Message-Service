import { HealthController } from "./health.controller";
describe("HealthController", () => {
  it.each([
    ["PONG", "ok"],
    ["NOPE", "error"],
  ])("health redis %s", async (reply, expected) => {
    const p: any = { $queryRaw: jest.fn().mockResolvedValue([1]) };
    const r: any = { ping: jest.fn().mockResolvedValue(reply) };
    const c = new HealthController(p, r);
    await expect(c.health()).resolves.toEqual({
      status: "ok",
      service: "message-service",
      database: "ok",
      redis: expected,
    });
  });
});
