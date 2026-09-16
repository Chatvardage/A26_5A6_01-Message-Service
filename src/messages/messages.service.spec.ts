import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { MessagesService } from "./messages.service";

describe("MessagesService", () => {
  const msg = {
    id: "m1",
    senderId: "u1",
    recipientId: "u2",
    content: "hi",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let prisma: any;
  let redis: any;
  let service: MessagesService;
  beforeEach(() => {
    prisma = {
      privateMessage: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    redis = { publish: jest.fn() };
    service = new MessagesService(prisma, redis);
  });
  it("creates then publishes", async () => {
    prisma.privateMessage.create.mockResolvedValue(msg);
    redis.publish.mockResolvedValue(1);
    await expect(
      service.create("u1", { recipientId: "u2", content: "hi" }),
    ).resolves.toBe(msg);
    expect(redis.publish).toHaveBeenCalledWith("private-message.created", msg);
  });
  it("does not publish when create fails", async () => {
    prisma.privateMessage.create.mockRejectedValue(new Error("db"));
    await expect(
      service.create("u1", { recipientId: "u2", content: "x" }),
    ).rejects.toThrow("db");
    expect(redis.publish).not.toHaveBeenCalled();
  });
  it("returns history", async () => {
    prisma.privateMessage.findMany.mockResolvedValue([msg]);
    await expect(service.history("u1", "u2")).resolves.toEqual([msg]);
    expect(prisma.privateMessage.findMany).toHaveBeenCalled();
  });
  it("findOne not found", async () => {
    prisma.privateMessage.findUnique.mockResolvedValue(null);
    await expect(service.findOne("u1", "x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it("findOne forbidden", async () => {
    prisma.privateMessage.findUnique.mockResolvedValue(msg);
    await expect(service.findOne("u3", "m1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it("findOne sender", async () => {
    prisma.privateMessage.findUnique.mockResolvedValue(msg);
    await expect(service.findOne("u1", "m1")).resolves.toBe(msg);
  });
  it("findOne recipient", async () => {
    prisma.privateMessage.findUnique.mockResolvedValue(msg);
    await expect(service.findOne("u2", "m1")).resolves.toBe(msg);
  });
  it("update not found", async () => {
    prisma.privateMessage.findUnique.mockResolvedValue(null);
    await expect(
      service.update("u1", "x", { content: "n" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it("update forbidden", async () => {
    prisma.privateMessage.findUnique.mockResolvedValue(msg);
    await expect(
      service.update("u2", "m1", { content: "n" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("updates then publishes", async () => {
    const updated = { ...msg, content: "n" };
    prisma.privateMessage.findUnique.mockResolvedValue(msg);
    prisma.privateMessage.update.mockResolvedValue(updated);
    redis.publish.mockResolvedValue(1);
    await expect(service.update("u1", "m1", { content: "n" })).resolves.toBe(
      updated,
    );
    expect(redis.publish).toHaveBeenCalledWith(
      "private-message.updated",
      updated,
    );
  });
  it("remove not found", async () => {
    prisma.privateMessage.findUnique.mockResolvedValue(null);
    await expect(service.remove("u1", "x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it("remove forbidden", async () => {
    prisma.privateMessage.findUnique.mockResolvedValue(msg);
    await expect(service.remove("u2", "m1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it("deletes then publishes routed event", async () => {
    prisma.privateMessage.findUnique.mockResolvedValue(msg);
    prisma.privateMessage.delete.mockResolvedValue(msg);
    redis.publish.mockResolvedValue(1);
    await service.remove("u1", "m1");
    expect(redis.publish).toHaveBeenCalledWith("private-message.deleted", {
      id: "m1",
      senderId: "u1",
      recipientId: "u2",
    });
  });
});
