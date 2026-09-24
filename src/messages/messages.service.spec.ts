import {
  HttpException,
  HttpStatus,
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
  let limiteEnvoi: any;
  let service: MessagesService;
  beforeEach(() => {
    prisma = {
      privateMessage: {
        create: jest.fn(),
        findMany: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    redis = { publish: jest.fn() };
    limiteEnvoi = { verifier: jest.fn() };
    service = new MessagesService(prisma, redis, limiteEnvoi);
  });
  it("creates then publishes", async () => {
    prisma.privateMessage.create.mockResolvedValue(msg);
    redis.publish.mockResolvedValue(1);
    await expect(
      service.create("u1", { recipientId: "u2", content: "hi" }),
    ).resolves.toBe(msg);
    expect(redis.publish).toHaveBeenCalledWith("private-message.created", msg);
    expect(limiteEnvoi.verifier).toHaveBeenCalledWith("u1");
  });
  it("rejects a private message over the send limit", async () => {
    limiteEnvoi.verifier.mockImplementation(() => {
      throw new HttpException("trop", HttpStatus.TOO_MANY_REQUESTS);
    });
    await expect(
      service.create("u1", { recipientId: "u2", content: "hi" }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(prisma.privateMessage.create).not.toHaveBeenCalled();
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
  it("returns an empty conversation list without loading any message", async () => {
    await expect(service.listConversations("u1")).resolves.toEqual([]);
    expect(prisma.privateMessage.groupBy).toHaveBeenCalledWith({
      by: ["recipientId"],
      where: { senderId: "u1" },
      _max: { createdAt: true },
    });
    expect(prisma.privateMessage.groupBy).toHaveBeenCalledWith({
      by: ["senderId"],
      where: { recipientId: "u1" },
      _max: { createdAt: true },
    });
    expect(prisma.privateMessage.findMany).not.toHaveBeenCalled();
  });

  it("only fetches the last message exchanged with each counterpart", async () => {
    const jan1 = new Date("2026-01-01");
    const jan2 = new Date("2026-01-02");
    const jan3 = new Date("2026-01-03");
    // Envoyés : dernier à u2 le 1er, à u3 le 2. Reçus : de u2 le 3 (plus
    // récent que l'envoi), de u3 le 1er (plus ancien), et une date nulle.
    prisma.privateMessage.groupBy
      .mockResolvedValueOnce([
        { recipientId: "u2", _max: { createdAt: jan1 } },
        { recipientId: "u3", _max: { createdAt: jan2 } },
      ])
      .mockResolvedValueOnce([
        { senderId: "u2", _max: { createdAt: jan3 } },
        { senderId: "u3", _max: { createdAt: jan1 } },
        { senderId: "u4", _max: { createdAt: null } },
      ]);
    prisma.privateMessage.findMany.mockResolvedValue([]);

    await service.listConversations("u1");

    expect(prisma.privateMessage.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            createdAt: jan3,
            OR: [
              { senderId: "u1", recipientId: "u2" },
              { senderId: "u2", recipientId: "u1" },
            ],
          },
          {
            createdAt: jan2,
            OR: [
              { senderId: "u1", recipientId: "u3" },
              { senderId: "u3", recipientId: "u1" },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("lists one conversation per counterpart, most recent activity first", async () => {
    const date = new Date("2026-01-03");
    const withU2 = {
      id: "m3",
      senderId: "u2",
      recipientId: "u1",
      content: "yo",
      createdAt: date,
      updatedAt: date,
    };
    // Même milliseconde que withU2 mais id plus petit : départagé par l'ordre
    // (createdAt desc, id desc) de la requête.
    const sameMsWithU2 = { ...withU2, id: "m2", content: "doublon" };
    const withU3 = {
      id: "m1",
      senderId: "u1",
      recipientId: "u3",
      content: "hey",
      createdAt: new Date("2026-01-02"),
      updatedAt: new Date("2026-01-02"),
    };
    prisma.privateMessage.groupBy
      .mockResolvedValueOnce([
        { recipientId: "u3", _max: { createdAt: withU3.createdAt } },
      ])
      .mockResolvedValueOnce([{ senderId: "u2", _max: { createdAt: date } }]);
    prisma.privateMessage.findMany.mockResolvedValue([
      withU2,
      sameMsWithU2,
      withU3,
    ]);

    await expect(service.listConversations("u1")).resolves.toEqual([
      { otherUserId: "u2", lastMessage: withU2 },
      { otherUserId: "u3", lastMessage: withU3 },
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
