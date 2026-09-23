import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { RoomMessagesService } from "./room-messages.service";

describe("RoomMessagesService", () => {
  const msg = {
    id: "m1",
    roomId: "r1",
    authorId: "u1",
    content: "hi",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const room = {
    type: "salon",
    id: "r1",
    nom: "General",
    visibilite: "public",
    membreIds: ["u1", "u2"],
    membresInvites: [],
  };
  let prisma: any;
  let redis: any;
  let rooms: any;
  let service: RoomMessagesService;

  beforeEach(() => {
    prisma = {
      roomMessage: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    redis = { publish: jest.fn() };
    rooms = { getRoom: jest.fn() };
    service = new RoomMessagesService(prisma, redis, rooms);
  });

  it("creates then publishes", async () => {
    rooms.getRoom.mockResolvedValue(room);
    prisma.roomMessage.create.mockResolvedValue(msg);
    redis.publish.mockResolvedValue(1);

    await expect(service.create("u1", "r1", { content: "hi" })).resolves.toBe(
      msg,
    );
    expect(rooms.getRoom).toHaveBeenCalledWith("r1");
    expect(prisma.roomMessage.create).toHaveBeenCalledWith({
      data: { roomId: "r1", authorId: "u1", content: "hi" },
    });
    expect(redis.publish).toHaveBeenCalledWith("room-message.created", msg);
  });

  it("rejects create when the caller is not a room member", async () => {
    rooms.getRoom.mockResolvedValue(room);

    await expect(
      service.create("stranger", "r1", { content: "hi" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.roomMessage.create).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it("propagates room lookup failures on create", async () => {
    rooms.getRoom.mockRejectedValue(new NotFoundException("Salon introuvable"));

    await expect(
      service.create("u1", "missing", { content: "hi" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.roomMessage.create).not.toHaveBeenCalled();
  });

  it("does not publish when create fails", async () => {
    rooms.getRoom.mockResolvedValue(room);
    prisma.roomMessage.create.mockRejectedValue(new Error("db"));

    await expect(service.create("u1", "r1", { content: "x" })).rejects.toThrow(
      "db",
    );
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it("returns history for a member", async () => {
    rooms.getRoom.mockResolvedValue(room);
    prisma.roomMessage.findMany.mockResolvedValue([msg]);

    await expect(service.history("u1", "r1", { limit: 50 })).resolves.toEqual([
      msg,
    ]);
    expect(prisma.roomMessage.findMany).toHaveBeenCalled();
  });

  it("rejects history when the caller is not a room member", async () => {
    rooms.getRoom.mockResolvedValue(room);

    await expect(
      service.history("stranger", "r1", { limit: 50 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.roomMessage.findMany).not.toHaveBeenCalled();
  });

  it("returns paginated history with cursor", async () => {
    rooms.getRoom.mockResolvedValue(room);
    prisma.roomMessage.findFirst.mockResolvedValue({ id: "m0" });
    prisma.roomMessage.findMany.mockResolvedValue([msg]);

    await expect(
      service.history("u1", "r1", { cursor: "m0", limit: 10 }),
    ).resolves.toEqual([msg]);
    expect(prisma.roomMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: "m0" }, skip: 1, take: 10 }),
    );
  });

  it("rejects a cursor outside the room", async () => {
    rooms.getRoom.mockResolvedValue(room);
    prisma.roomMessage.findFirst.mockResolvedValue(null);

    await expect(
      service.history("u1", "r1", { cursor: "other-message", limit: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.roomMessage.findMany).not.toHaveBeenCalled();
  });

  it("findOne not found", async () => {
    rooms.getRoom.mockResolvedValue(room);
    prisma.roomMessage.findUnique.mockResolvedValue(null);

    await expect(service.findOne("u1", "r1", "x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("findOne not found when message belongs to a different room", async () => {
    rooms.getRoom.mockResolvedValue(room);
    prisma.roomMessage.findUnique.mockResolvedValue({ ...msg, roomId: "r2" });

    await expect(service.findOne("u1", "r1", "m1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("findOne forbidden for a non-member", async () => {
    rooms.getRoom.mockResolvedValue(room);

    await expect(
      service.findOne("stranger", "r1", "m1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.roomMessage.findUnique).not.toHaveBeenCalled();
  });

  it("findOne returns the message for any room member", async () => {
    rooms.getRoom.mockResolvedValue(room);
    prisma.roomMessage.findUnique.mockResolvedValue(msg);

    await expect(service.findOne("u2", "r1", "m1")).resolves.toBe(msg);
  });

  it("update not found", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue(null);
    await expect(
      service.update("u1", "r1", "x", { content: "n" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update not found when message belongs to a different room", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue({ ...msg, roomId: "r2" });
    await expect(
      service.update("u1", "r1", "m1", { content: "n" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update forbidden for a non-author", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue(msg);
    await expect(
      service.update("u2", "r1", "m1", { content: "n" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("updates then publishes", async () => {
    const updated = { ...msg, content: "n" };
    prisma.roomMessage.findUnique.mockResolvedValue(msg);
    prisma.roomMessage.update.mockResolvedValue(updated);
    redis.publish.mockResolvedValue(1);

    await expect(
      service.update("u1", "r1", "m1", { content: "n" }),
    ).resolves.toBe(updated);
    expect(redis.publish).toHaveBeenCalledWith("room-message.updated", updated);
  });

  it("remove not found", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue(null);
    await expect(service.remove("u1", "r1", "x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("remove not found when message belongs to a different room", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue({ ...msg, roomId: "r2" });
    await expect(service.remove("u1", "r1", "m1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("remove forbidden for a non-author", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue(msg);
    await expect(service.remove("u2", "r1", "m1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("deletes then publishes routed event", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue(msg);
    prisma.roomMessage.delete.mockResolvedValue(msg);
    redis.publish.mockResolvedValue(1);

    await service.remove("u1", "r1", "m1");
    expect(redis.publish).toHaveBeenCalledWith("room-message.deleted", {
      id: "m1",
      roomId: "r1",
      authorId: "u1",
    });
  });
});
