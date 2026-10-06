import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EtatLectureService, idConversation } from './etat-lecture.service';

describe('EtatLectureService', () => {
  const t = (minute: number) => new Date(Date.UTC(2026, 9, 6, 12, minute));
  const moi = { id: 'moi', role: 'utilisateur' as const };
  let prisma: any;
  let rooms: any;
  let service: EtatLectureService;

  beforeEach(() => {
    prisma = {
      privateMessage: {
        findFirst: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      roomMessage: {
        findFirst: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      conversationReadState: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        createMany: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    rooms = {
      verifierAcces: jest.fn().mockResolvedValue({ peutLire: true }),
      salonsLisibles: jest.fn().mockResolvedValue([]),
    };
    service = new EtatLectureService(prisma, rooms);
  });

  it('forme les identifiants de conversation du client mobile', () => {
    expect(idConversation('dm', 'u1')).toBe('dm:u1');
    expect(idConversation('room', 'r1')).toBe('room:r1');
  });

  describe('compteursDm', () => {
    it('compte les messages reçus après chaque lecture, et tous ceux des conversations jamais lues', async () => {
      prisma.conversationReadState.findMany.mockResolvedValue([
        { targetId: 'alice', lastReadAt: t(2) },
      ]);
      prisma.privateMessage.groupBy.mockResolvedValue([
        { senderId: 'alice', _count: { _all: 1 } },
        { senderId: 'bob', _count: { _all: 3 } },
      ]);

      await expect(service.compteursDm('moi')).resolves.toEqual(
        new Map([
          ['alice', 1],
          ['bob', 3],
        ]),
      );
      expect(prisma.conversationReadState.findMany).toHaveBeenCalledWith({
        where: { userId: 'moi', kind: 'dm' },
        select: { targetId: true, lastReadAt: true },
      });
      expect(prisma.privateMessage.groupBy).toHaveBeenCalledWith({
        by: ['senderId'],
        where: {
          recipientId: 'moi',
          OR: [
            { senderId: 'alice', createdAt: { gt: t(2) } },
            { senderId: { notIn: ['alice'] } },
          ],
        },
        _count: { _all: true },
      });
    });

    it('se limite à un interlocuteur', async () => {
      await service.compteursDm('moi', 'alice');
      expect(prisma.conversationReadState.findMany).toHaveBeenCalledWith({
        where: { userId: 'moi', kind: 'dm', targetId: 'alice' },
        select: { targetId: true, lastReadAt: true },
      });
      expect(prisma.privateMessage.groupBy.mock.calls[0][0].where).toEqual({
        recipientId: 'moi',
        senderId: 'alice',
        OR: [{ senderId: { notIn: [] } }],
      });
    });
  });

  describe('compteurs', () => {
    it('réunit DM et salons sous les identifiants du client mobile', async () => {
      prisma.privateMessage.groupBy.mockResolvedValue([
        { senderId: 'alice', _count: { _all: 2 } },
      ]);
      rooms.salonsLisibles.mockResolvedValue([
        { salonId: 'r1', serveurId: 's', depuis: t(0) },
      ]);
      prisma.roomMessage.groupBy.mockResolvedValue([
        { roomId: 'r1', _count: { _all: 5 } },
      ]);

      await expect(service.compteurs(moi)).resolves.toEqual({
        'dm:alice': 2,
        'room:r1': 5,
      });
      expect(rooms.salonsLisibles).toHaveBeenCalledWith(moi);
    });

    it('sans salon lisible, ne compte aucun message de salon', async () => {
      await expect(service.compteurs(moi)).resolves.toEqual({});
      expect(prisma.roomMessage.groupBy).not.toHaveBeenCalled();
    });

    it("compte depuis la plus récente entre la lecture et l'arrivée ; rien sans l'une ni l'autre", async () => {
      rooms.salonsLisibles.mockResolvedValue([
        { salonId: 'lu-apres', serveurId: 's', depuis: t(1) },
        { salonId: 'arrive-apres', serveurId: 's', depuis: t(9) },
        { salonId: 'lu-seulement', serveurId: 's', depuis: null },
        { salonId: 'arrive-seulement', serveurId: 's', depuis: t(4) },
        { salonId: 'inconnu', serveurId: 's', depuis: null },
      ]);
      prisma.conversationReadState.findMany
        .mockResolvedValueOnce([]) // DM
        .mockResolvedValueOnce([
          { targetId: 'lu-apres', lastReadAt: t(5) },
          { targetId: 'arrive-apres', lastReadAt: t(3) },
          { targetId: 'lu-seulement', lastReadAt: t(7) },
        ]);

      await service.compteurs(moi);

      expect(prisma.roomMessage.groupBy).toHaveBeenCalledWith({
        by: ['roomId'],
        where: {
          authorId: { not: 'moi' },
          OR: [
            { roomId: 'lu-apres', createdAt: { gt: t(5) } },
            { roomId: 'arrive-apres', createdAt: { gt: t(9) } },
            { roomId: 'lu-seulement', createdAt: { gt: t(7) } },
            { roomId: 'arrive-seulement', createdAt: { gt: t(4) } },
          ],
        },
        _count: { _all: true },
      });
    });

    it('aucun seuil connu : aucune requête de messages de salon', async () => {
      rooms.salonsLisibles.mockResolvedValue([
        { salonId: 'r1', serveurId: 's', depuis: null },
      ]);
      await expect(service.compteurs(moi)).resolves.toEqual({});
      expect(prisma.roomMessage.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('marquerDmLu', () => {
    const conversation = {
      OR: [
        { senderId: 'moi', recipientId: 'alice' },
        { senderId: 'alice', recipientId: 'moi' },
      ],
    };

    it("avance jusqu'au dernier message sans jamais reculer", async () => {
      prisma.privateMessage.findFirst.mockResolvedValue({
        id: 'm2',
        createdAt: t(2),
      });
      prisma.conversationReadState.findUniqueOrThrow.mockResolvedValue({
        lastReadAt: t(2),
      });
      prisma.privateMessage.groupBy.mockResolvedValue([
        { senderId: 'alice', _count: { _all: 1 } },
      ]);

      await expect(service.marquerDmLu('moi', 'alice')).resolves.toEqual({
        conversationId: 'dm:alice',
        lastReadAt: t(2),
        unreadCount: 1,
      });
      expect(prisma.privateMessage.findFirst).toHaveBeenCalledWith({
        where: conversation,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, createdAt: true },
      });
      expect(prisma.conversationReadState.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'moi',
            kind: 'dm',
            targetId: 'alice',
            lastReadAt: t(2),
          },
        ],
        skipDuplicates: true,
      });
      expect(prisma.conversationReadState.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'moi',
          kind: 'dm',
          targetId: 'alice',
          lastReadAt: { lt: t(2) },
        },
        data: { lastReadAt: t(2) },
      });
      expect(
        prisma.conversationReadState.findUniqueOrThrow,
      ).toHaveBeenCalledWith({
        where: {
          userId_kind_targetId: {
            userId: 'moi',
            kind: 'dm',
            targetId: 'alice',
          },
        },
        select: { lastReadAt: true },
      });
    });

    it("cherche le message indiqué dans cette conversation ; ailleurs, c'est une 400", async () => {
      prisma.privateMessage.findFirst.mockResolvedValue(null);
      await expect(
        service.marquerDmLu('moi', 'alice', 'etranger'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.privateMessage.findFirst.mock.calls[0][0].where).toEqual({
        id: 'etranger',
        ...conversation,
      });
      expect(prisma.conversationReadState.createMany).not.toHaveBeenCalled();
    });

    it('conversation vide : ne marque rien et renvoie l’état existant', async () => {
      prisma.privateMessage.findFirst.mockResolvedValue(null);
      prisma.conversationReadState.findUnique.mockResolvedValueOnce({
        lastReadAt: t(1),
      });
      await expect(service.marquerDmLu('moi', 'alice')).resolves.toEqual({
        conversationId: 'dm:alice',
        lastReadAt: t(1),
        unreadCount: 0,
      });

      prisma.conversationReadState.findUnique.mockResolvedValueOnce(null);
      await expect(service.marquerDmLu('moi', 'alice')).resolves.toMatchObject({
        lastReadAt: null,
      });
      expect(prisma.conversationReadState.createMany).not.toHaveBeenCalled();
    });
  });

  describe('marquerSalonLu', () => {
    it('exige la lecture du salon', async () => {
      rooms.verifierAcces.mockResolvedValue({ peutLire: false });
      await expect(service.marquerSalonLu(moi, 'r1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(rooms.verifierAcces).toHaveBeenCalledWith('r1', moi);
      expect(prisma.roomMessage.findFirst).not.toHaveBeenCalled();
    });

    it("avance jusqu'au message indiqué du salon et recompte depuis l'arrivée", async () => {
      prisma.roomMessage.findFirst.mockResolvedValue({
        id: 'm3',
        createdAt: t(3),
      });
      prisma.conversationReadState.findUniqueOrThrow.mockResolvedValue({
        lastReadAt: t(3),
      });
      rooms.salonsLisibles.mockResolvedValue([
        { salonId: 'r1', serveurId: 's', depuis: t(0) },
      ]);
      prisma.conversationReadState.findMany.mockResolvedValue([
        { targetId: 'r1', lastReadAt: t(3) },
      ]);
      prisma.roomMessage.groupBy.mockResolvedValue([
        { roomId: 'r1', _count: { _all: 2 } },
      ]);

      await expect(service.marquerSalonLu(moi, 'r1', 'm3')).resolves.toEqual({
        conversationId: 'room:r1',
        lastReadAt: t(3),
        unreadCount: 2,
      });
      expect(prisma.roomMessage.findFirst.mock.calls[0][0].where).toEqual({
        id: 'm3',
        roomId: 'r1',
      });
      expect(prisma.roomMessage.groupBy.mock.calls[0][0].where.OR).toEqual([
        { roomId: 'r1', createdAt: { gt: t(3) } },
      ]);
    });

    it('salon absent de la liste (cache périmé) : compte depuis la lecture seule', async () => {
      prisma.roomMessage.findFirst.mockResolvedValue({
        id: 'm1',
        createdAt: t(1),
      });
      prisma.conversationReadState.findUniqueOrThrow.mockResolvedValue({
        lastReadAt: t(1),
      });
      await expect(service.marquerSalonLu(moi, 'r1')).resolves.toMatchObject({
        unreadCount: 0,
      });
      expect(prisma.roomMessage.findFirst.mock.calls[0][0].where).toEqual({
        roomId: 'r1',
      });
    });
  });

  it('efface les états d’un compte supprimé et de ses interlocuteurs', async () => {
    await service.supprimerUtilisateur('parti');
    expect(prisma.conversationReadState.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ userId: 'parti' }, { kind: 'dm', targetId: 'parti' }] },
    });
  });

  it('efface les états des salons supprimés', async () => {
    await service.purgerSalons(['r1', 'r2']);
    expect(prisma.conversationReadState.deleteMany).toHaveBeenCalledWith({
      where: { kind: 'room', targetId: { in: ['r1', 'r2'] } },
    });
  });
});
