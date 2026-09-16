import { PrismaService } from "./prisma.service";
describe("PrismaService", () => {
  it("connects and disconnects", async () => {
    const s = new PrismaService();
    const c = jest.spyOn(s, "$connect").mockResolvedValue();
    const d = jest.spyOn(s, "$disconnect").mockResolvedValue();
    await s.onModuleInit();
    await s.onModuleDestroy();
    expect(c).toHaveBeenCalled();
    expect(d).toHaveBeenCalled();
  });
});
