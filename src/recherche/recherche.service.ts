import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, PrivateMessage, RoomMessage } from '@prisma/client';
import { idConversation } from '../lecture/etat-lecture.service';
import { PrismaService } from '../prisma.service';
import { Acteur, RoomsClientService } from '../rooms/rooms-client.service';
import { RechercheQueryDto } from './dto/recherche-query.dto';

export type ResultatRecherche =
  | { conversationId: string; kind: 'dm'; message: PrivateMessage }
  | { conversationId: string; kind: 'room'; message: RoomMessage };

export type PageRecherche = {
  results: ResultatRecherche[];
  /** À renvoyer en `cursor` pour la page suivante ; `null` à la fin. */
  nextCursor: string | null;
};

type Position = { createdAt: Date; id: string };

/** `%`, `_` et `\` pris littéralement dans le motif LIKE de Prisma. */
export const echapperMotif = (texte: string) =>
  texte.replace(/[\\%_]/g, (c) => `\\${c}`);

export const encoderCurseur = ({ createdAt, id }: Position) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

export function decoderCurseur(curseur: string): Position {
  const [date, id, ...reste] = Buffer.from(curseur, 'base64url')
    .toString()
    .split('|');
  const createdAt = new Date(date);
  if (!id || reste.length > 0 || Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException('Curseur de recherche invalide');
  }
  return { createdAt, id };
}

/** Du plus récent au plus ancien, l'identifiant départageant les égalités. */
const plusRecentDAbord = (a: Position, b: Position) =>
  b.createdAt.getTime() - a.createdAt.getTime() ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * Recherche textuelle dans les seules conversations accessibles : les DM
 * dont l'utilisateur est expéditeur ou destinataire, et les salons qu'il
 * peut lire selon Room-Service (aucune règle de droits recodée ici). Si
 * Room-Service ne répond pas, la recherche échoue (503) plutôt que de
 * renvoyer des résultats incomplets ou trop larges.
 */
@Injectable()
export class RechercheService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsClientService,
  ) {}

  async rechercher(
    acteur: Acteur,
    query: RechercheQueryDto,
  ): Promise<PageRecherche> {
    const apres = query.cursor ? decoderCurseur(query.cursor) : null;
    const contenu = {
      contains: echapperMotif(query.q),
      mode: 'insensitive' as const,
    };
    // Pagination par position (createdAt, id) : ni doublon ni trou entre
    // deux pages, même si des messages arrivent entre-temps.
    const avant = apres
      ? {
          OR: [
            { createdAt: { lt: apres.createdAt } },
            { createdAt: apres.createdAt, id: { lt: apres.id } },
          ],
        }
      : {};
    const ordre: Prisma.PrivateMessageOrderByWithRelationInput[] = [
      { createdAt: 'desc' },
      { id: 'desc' },
    ];
    // Un de plus que demandé, pour savoir s'il reste une page.
    const take = query.limit + 1;

    const salonIds = (await this.rooms.salonsLisibles(acteur)).map(
      (s) => s.salonId,
    );
    const [dms, salons] = await Promise.all([
      this.prisma.privateMessage.findMany({
        where: {
          AND: [
            { OR: [{ senderId: acteur.id }, { recipientId: acteur.id }] },
            avant,
          ],
          content: contenu,
        },
        orderBy: ordre,
        take,
      }),
      salonIds.length === 0
        ? Promise.resolve([])
        : this.prisma.roomMessage.findMany({
            where: { roomId: { in: salonIds }, content: contenu, ...avant },
            orderBy: ordre,
            take,
          }),
    ]);

    const fusion: ResultatRecherche[] = [
      ...dms.map((message): ResultatRecherche => ({
        conversationId: idConversation(
          'dm',
          message.senderId === acteur.id
            ? message.recipientId
            : message.senderId,
        ),
        kind: 'dm',
        message,
      })),
      ...salons.map((message): ResultatRecherche => ({
        conversationId: idConversation('room', message.roomId),
        kind: 'room',
        message,
      })),
    ].sort((a, b) => plusRecentDAbord(a.message, b.message));

    const results = fusion.slice(0, query.limit);
    return {
      results,
      nextCursor:
        fusion.length > query.limit
          ? encoderCurseur(results[results.length - 1].message)
          : null,
    };
  }
}
