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
  // Réponse de la route interne de Room-Service.
  const lecteurEcrivain = {
    salonId: "r1",
    serveurId: "s1",
    estMembre: true,
    peutLire: true,
    peutEcrire: true,
  };
  const lectureSeule = { ...lecteurEcrivain, peutEcrire: false };
  const sansAcces = {
    ...lecteurEcrivain,
    estMembre: false,
    peutLire: false,
    peutEcrire: false,
  };
  const acteur = (id: string) => ({ id, role: "utilisateur" as const });
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
    rooms = { verifierAcces: jest.fn().mockResolvedValue(lecteurEcrivain) };
    service = new RoomMessagesService(prisma, redis, rooms);
  });

  it("creates then publishes", async () => {
    prisma.roomMessage.create.mockResolvedValue(msg);
    redis.publish.mockResolvedValue(1);

    await expect(
      service.create(acteur("u1"), "r1", { content: "hi" }),
    ).resolves.toBe(msg);
    expect(rooms.verifierAcces).toHaveBeenCalledWith("r1", acteur("u1"));
    expect(prisma.roomMessage.create).toHaveBeenCalledWith({
      data: { roomId: "r1", authorId: "u1", content: "hi" },
    });
    expect(redis.publish).toHaveBeenCalledWith("room-message.created", msg);
  });

  it("rejects create when the caller is not a room member", async () => {
    rooms.verifierAcces.mockResolvedValue(sansAcces);

    await expect(
      service.create(acteur("stranger"), "r1", { content: "hi" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.roomMessage.create).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it("propagates room lookup failures on create", async () => {
    rooms.verifierAcces.mockRejectedValue(
      new NotFoundException("Salon introuvable"),
    );

    await expect(
      service.create(acteur("u1"), "missing", { content: "hi" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.roomMessage.create).not.toHaveBeenCalled();
  });

  it("does not publish when create fails", async () => {
    prisma.roomMessage.create.mockRejectedValue(new Error("db"));

    await expect(
      service.create(acteur("u1"), "r1", { content: "x" }),
    ).rejects.toThrow("db");
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it("returns history for a member", async () => {
    prisma.roomMessage.findMany.mockResolvedValue([msg]);

    await expect(
      service.history(acteur("u1"), "r1", { limit: 50 }),
    ).resolves.toEqual([msg]);
    expect(prisma.roomMessage.findMany).toHaveBeenCalled();
  });

  it("rejects history when the caller is not a room member", async () => {
    rooms.verifierAcces.mockResolvedValue(sansAcces);

    await expect(
      service.history(acteur("stranger"), "r1", { limit: 50 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.roomMessage.findMany).not.toHaveBeenCalled();
  });

  it("returns paginated history with cursor", async () => {
    prisma.roomMessage.findFirst.mockResolvedValue({ id: "m0" });
    prisma.roomMessage.findMany.mockResolvedValue([msg]);

    await expect(
      service.history(acteur("u1"), "r1", { cursor: "m0", limit: 10 }),
    ).resolves.toEqual([msg]);
    expect(prisma.roomMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: "m0" }, skip: 1, take: 10 }),
    );
  });

  it("rejects a cursor outside the room", async () => {
    prisma.roomMessage.findFirst.mockResolvedValue(null);

    await expect(
      service.history(acteur("u1"), "r1", {
        cursor: "other-message",
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.roomMessage.findMany).not.toHaveBeenCalled();
  });

  it("findOne not found", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue(null);

    await expect(
      service.findOne(acteur("u1"), "r1", "x"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("findOne not found when message belongs to a different room", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue({ ...msg, roomId: "r2" });

    await expect(
      service.findOne(acteur("u1"), "r1", "m1"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("findOne forbidden for a non-member", async () => {
    rooms.verifierAcces.mockResolvedValue(sansAcces);

    await expect(
      service.findOne(acteur("stranger"), "r1", "m1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.roomMessage.findUnique).not.toHaveBeenCalled();
  });

  it("findOne returns the message for any room member", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue(msg);

    await expect(service.findOne(acteur("u2"), "r1", "m1")).resolves.toBe(msg);
  });

  it("update not found", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue(null);
    await expect(
      service.update(acteur("u1"), "r1", "x", { content: "n" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update not found when message belongs to a different room", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue({ ...msg, roomId: "r2" });
    await expect(
      service.update(acteur("u1"), "r1", "m1", { content: "n" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update forbidden for a non-author", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue(msg);
    await expect(
      service.update(acteur("u2"), "r1", "m1", { content: "n" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("updates then publishes", async () => {
    const updated = { ...msg, content: "n" };
    prisma.roomMessage.findUnique.mockResolvedValue(msg);
    prisma.roomMessage.update.mockResolvedValue(updated);
    redis.publish.mockResolvedValue(1);

    await expect(
      service.update(acteur("u1"), "r1", "m1", { content: "n" }),
    ).resolves.toBe(updated);
    expect(redis.publish).toHaveBeenCalledWith("room-message.updated", updated);
  });

  it("remove not found", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue(null);
    await expect(
      service.remove(acteur("u1"), "r1", "x"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("remove not found when message belongs to a different room", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue({ ...msg, roomId: "r2" });
    await expect(
      service.remove(acteur("u1"), "r1", "m1"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("remove forbidden for a non-author", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue(msg);
    await expect(
      service.remove(acteur("u2"), "r1", "m1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("deletes then publishes routed event", async () => {
    prisma.roomMessage.findUnique.mockResolvedValue(msg);
    prisma.roomMessage.delete.mockResolvedValue(msg);
    redis.publish.mockResolvedValue(1);

    await service.remove(acteur("u1"), "r1", "m1");
    expect(redis.publish).toHaveBeenCalledWith("room-message.deleted", {
      id: "m1",
      roomId: "r1",
      authorId: "u1",
    });
  });

  it("rejects create in a read-only room (#annonces) for a member", async () => {
    rooms.verifierAcces.mockResolvedValue(lectureSeule);

    await expect(
      service.create(acteur("u1"), "r1", { content: "hi" }),
    ).rejects.toThrow("Seuls les modérateurs peuvent écrire dans ce salon");
    expect(prisma.roomMessage.create).not.toHaveBeenCalled();
  });

  it.each(["update", "remove"] as const)(
    "rejects %s when the caller lost access to the room",
    async (methode) => {
      rooms.verifierAcces.mockResolvedValue(sansAcces);
      const appel =
        methode === "update"
          ? service.update(acteur("u1"), "r1", "m1", { content: "n" })
          : service.remove(acteur("u1"), "r1", "m1");

      await expect(appel).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.roomMessage.findUnique).not.toHaveBeenCalled();
    },
  );
});
