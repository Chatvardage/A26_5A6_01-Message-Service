import { PrismaService } from "./prisma.service";
describe("PrismaService", () => {
  it("connects and disconnects", async () => {
    const s = new PrismaService();
    const c = jest.spyOn(s, "$connect").mockResolvedValue(undefined);
    const d = jest.spyOn(s, "$disconnect").mockResolvedValue(undefined);
    await s.onModuleInit();
    await s.onModuleDestroy();
    expect(c).toHaveBeenCalled();
    expect(d).toHaveBeenCalled();
  });
});
