import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
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
        findFirst: jest.fn(),
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
  it("rejects a private message sent to self", async () => {
    await expect(
      service.create("u1", { recipientId: "u1", content: "hi" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.privateMessage.create).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
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
    await expect(service.history("u1", "u2", { limit: 50 })).resolves.toEqual([
      msg,
    ]);
    expect(prisma.privateMessage.findMany).toHaveBeenCalled();
  });
  it("returns paginated history with cursor", async () => {
    prisma.privateMessage.findFirst.mockResolvedValue({ id: "m0" });
    prisma.privateMessage.findMany.mockResolvedValue([msg]);
    await expect(
      service.history("u1", "u2", { cursor: "m0", limit: 10 }),
    ).resolves.toEqual([msg]);
    expect(prisma.privateMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: "m0" }, skip: 1, take: 10 }),
    );
  });
  it("rejects a cursor outside the conversation", async () => {
    prisma.privateMessage.findFirst.mockResolvedValue(null);

    await expect(
      service.history("u1", "u2", { cursor: "other-message", limit: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.privateMessage.findMany).not.toHaveBeenCalled();
  });
  it("returns an empty conversation list when the user has no messages", async () => {
    prisma.privateMessage.findMany.mockResolvedValue([]);
    await expect(service.listConversations("u1")).resolves.toEqual([]);
    expect(prisma.privateMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ senderId: "u1" }, { recipientId: "u1" }] },
      }),
    );
  });

  it("lists one conversation per counterpart, most recent activity first", async () => {
    const newestWithU2 = {
      id: "m3",
      senderId: "u2",
      recipientId: "u1",
      content: "yo",
      createdAt: new Date("2026-01-03"),
      updatedAt: new Date("2026-01-03"),
    };
    const newestWithU3 = {
      id: "m2",
      senderId: "u1",
      recipientId: "u3",
      content: "hey",
      createdAt: new Date("2026-01-02"),
      updatedAt: new Date("2026-01-02"),
    };
    const olderWithU2 = {
      id: "m1",
      senderId: "u1",
      recipientId: "u2",
      content: "salut",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    };
    // findMany is mocked to already return newest-first, matching the
    // orderBy passed to Prisma.
    prisma.privateMessage.findMany.mockResolvedValue([
      newestWithU2,
      newestWithU3,
      olderWithU2,
    ]);

    await expect(service.listConversations("u1")).resolves.toEqual([
      { otherUserId: "u2", lastMessage: newestWithU2 },
      { otherUserId: "u3", lastMessage: newestWithU3 },
    ]);
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
