import {
  ForbiddenException,
  Logger,
  OnModuleDestroy,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PrivateMessage, RoomMessage } from '@prisma/client';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { RemoteSocket, Server, Socket } from 'socket.io';
import { AuthenticatedUser, JwtAuthService } from '../auth/jwt-auth.service';
import {
  RAISONS_SERVEUR,
  RaisonServeur,
} from '../internal/evenement-serveur.dto';
import { SERVEUR_CHANNEL } from '../internal/internal-events.controller';
import { RedisService } from '../redis.service';
import { RoomMessagesService } from '../room-messages/room-messages.service';
import { RoomIdDto } from '../room-messages/dto/room-id.dto';
import { SendRoomMessageDto } from '../room-messages/dto/send-room-message.dto';
import { Acteur, RoomsClientService } from '../rooms/rooms-client.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { PresenceDto } from './dto/presence.dto';
import { TypingDto } from './dto/typing.dto';
import { MessagesService } from './messages.service';

interface SocketData {
  userId?: string;
  // Rôle global (Authentification), transmis à Room-Service pour les
  // droits des salons (ex. un admin peut écrire dans #annonces).
  role?: AuthenticatedUser['role'];
  // Dernière présence annoncée sur ce socket (voir updatePresence), pour
  // l'instantané envoyé aux nouveaux clients.
  presence?: PresenceEvent['statut'];
  // Salons rejoints par ce socket (id du salon -> id de son serveur), pour
  // retirer le socket d'un salon dont il perd l'accès (voir
  // revoquerAccesPerdus).
  salons?: Record<string, string>;
  // Dernier 'typing' relayé par cible (room:<id> / user:<id>), voir
  // DELAI_MIN_SAISIE_MS.
  saisies?: Record<string, { isTyping: boolean; temps: number }>;
}

// Événements émis depuis un socket (les autres passent par this.server) :
// instantané de présence d'un nouveau client, indicateur de frappe relayé.
interface EvenementsVersClient {
  'presence.snapshot': (payload: { enLigne: string[] }) => void;
  // Authentification du socket terminée (voir handleConnection) : le client
  // peut maintenant annoncer sa présence et rejoindre ses salons. Avant, ses
  // événements sont refusés (voir requireUserId) — ce qui laissait un client
  // reconnecté « hors ligne » pour les autres.
  'connexion.prete': () => void;
  typing: (payload: {
    userId: string;
    scope: 'room' | 'dm';
    targetId: string;
    isTyping: boolean;
  }) => void;
  // Le socket a été retiré de ce salon (accès perdu) : le client l'oublie et
  // le rejoindra de nouveau s'il le retrouve dans ses salons accessibles.
  'room-message.revoked': (payload: { roomId: string }) => void;
  // Jeton refusé par Authentification (révoqué, expiré, compte supprimé) :
  // le socket est ensuite déconnecté ; le client vérifie sa session.
  'session.revoquee': () => void;
}

type AuthenticatedSocket = Socket<
  Record<string, never>,
  EvenementsVersClient,
  Record<string, never>,
  SocketData
>;

interface PrivateMessageEvent {
  id: string;
  senderId: string;
  recipientId: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface RoomMessageEvent {
  id: string;
  roomId: string;
  authorId: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
}

const PRIVATE_MESSAGE_CHANNELS = [
  'private-message.created',
  'private-message.updated',
  'private-message.deleted',
];

// Présence en temps réel : diffusée à tous les clients connectés (la
// présence est déjà publique pour tout utilisateur authentifié, voir
// GET /api/config-utilisateur/publiques). Passe par Redis pour atteindre les
// clients de toutes les instances de Message-Service.
const PRESENCE_CHANNEL = 'presence.changed';
// Profil public modifié (alias, avatar, pseudo) : diffusé à tous, chaque
// client recharge ce profil (voir updateProfil).
const PROFIL_CHANNEL = 'profil.changed';
// Un `profil.update` est diffusé à TOUS les clients, et chacun recharge
// alors ce profil (2 requêtes HTTP) : au plus un envoi par socket sur cette
// fenêtre, pour qu'un client ne puisse pas faire générer une avalanche de
// requêtes aux autres. Les demandes rapprochées ne sont pas perdues : une
// seule est envoyée à la fin de la fenêtre (le client relit alors l'état
// le plus récent).
export const DELAI_MIN_PROFIL_MS = 5000;
// 'typing' : le client en envoie un à chaque frappe, et un message privé peut
// viser n'importe qui. Un CHANGEMENT d'état (commence / arrête d'écrire) est
// toujours relayé ; le même état répété vers la même cible, au plus une fois
// par fenêtre (les destinataires gardent l'état jusqu'au changement).
export const DELAI_MIN_SAISIE_MS = 1000;
// Un socket n'était authentifié qu'à la connexion : un jeton révoqué (mot de
// passe changé, compte supprimé) ou expiré continuait de recevoir messages
// et présence tant que le socket restait ouvert. Chaque socket est donc
// revalidé à cet intervalle (voir revaliderSockets) ; le cache du client
// d'authentification limite le coût.
export const INTERVALLE_REVALIDATION_MS = 60_000;

interface EvenementServeur {
  serveurId: string;
  raison: RaisonServeur;
  cibleId: string | null;
  utilisateurIds: string[];
}

interface PresenceEvent {
  userId: string;
  statut: 'en-ligne' | 'hors-ligne';
}

const ROOM_MESSAGE_CHANNELS = [
  'room-message.created',
  'room-message.updated',
  'room-message.deleted',
];

/**
 * Utilisateurs dont l'accès aux salons d'un serveur a pu changer :
 * - `expulse` / `membres` (départ, rôle modifié) : la personne visée ;
 * - `salons` (salon rendu réservé ou supprimé) et `supprime` : tous les
 *   destinataires.
 * Une arrivée (`membres`) n'enlève aucun accès : la revérification ne coûte
 * alors qu'un appel pour les salons déjà rejoints par cette personne.
 */
export function utilisateursARevalider(event: EvenementServeur): string[] {
  switch (event.raison) {
    case 'expulse':
    case 'membres':
      return event.cibleId ? [event.cibleId] : [];
    case 'salons':
    case 'supprime':
      return event.utilisateurIds;
    default:
      return [];
  }
}

export function isAllowedOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
): void {
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  // Les clients non-navigateurs (ex. Electron/CLI) peuvent ne pas envoyer Origin.
  callback(null, origin === undefined || allowedOrigins.includes(origin));
}

/** Refus d'Authentification (jeton absent, invalide, expiré ou révoqué). */
function estJetonRefuse(erreur: unknown): boolean {
  return (
    erreur instanceof UnauthorizedException ||
    erreur instanceof ForbiddenException ||
    erreur instanceof WsException
  );
}

@WebSocketGateway({
  namespace: '/messages',
  cors: {
    // Évalue CORS_ORIGINS au moment de la connexion plutôt qu'à l'import.
    origin: isAllowedOrigin,
    credentials: false,
  },
})
export class MessagesGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(MessagesGateway.name);
  private minuteurRevalidation?: ReturnType<typeof setInterval>;
  // Limite de `profil.update` par socket (voir DELAI_MIN_PROFIL_MS).
  private readonly limitesProfil = new Map<
    string,
    { dernierEnvoi: number; envoiDiffere?: ReturnType<typeof setTimeout> }
  >();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly messages: MessagesService,
    private readonly redis: RedisService,
    private readonly jwt: JwtAuthService,
    private readonly roomMessages: RoomMessagesService,
    private readonly rooms: RoomsClientService,
  ) {}

  async afterInit(): Promise<void> {
    await this.redis.subscribe(
      [
        ...PRIVATE_MESSAGE_CHANNELS,
        ...ROOM_MESSAGE_CHANNELS,
        PRESENCE_CHANNEL,
        PROFIL_CHANNEL,
        SERVEUR_CHANNEL,
      ],
      (channel, payload) => this.broadcastRedisEvent(channel, payload),
    );
    this.minuteurRevalidation = setInterval(() => {
      this.revaliderSockets().catch((erreur: unknown) => {
        this.logger.error(`Revalidation des sockets: ${String(erreur)}`);
      });
    }, INTERVALLE_REVALIDATION_MS);
    this.minuteurRevalidation.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.minuteurRevalidation);
  }

  /**
   * Revalide le jeton de chaque socket authentifié. Jeton refusé : le socket
   * reçoit `session.revoquee` puis est déconnecté. Authentification
   * indisponible : le socket est gardé (une panne d'Auth ne doit pas couper
   * tout le monde). Sinon, le rôle global est mis à jour (droits des salons).
   */
  async revaliderSockets(): Promise<void> {
    const sockets =
      (await this.server.fetchSockets()) as unknown as RemoteSocket<
        EvenementsVersClient,
        SocketData
      >[];
    for (const socket of sockets) {
      // Encore en cours d'authentification (voir handleConnection).
      if (!socket.data.userId) continue;
      try {
        const user = await this.jwt.verifyToken(this.readSocketToken(socket));
        socket.data.role = user.role;
      } catch (erreur) {
        if (!estJetonRefuse(erreur)) continue;
        this.logger.warn(`Jeton refusé, socket déconnecté [${socket.id}]`);
        socket.emit('session.revoquee');
        socket.disconnect(true);
      }
    }
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = this.readSocketToken(client);
      const user = await this.jwt.verifyToken(token);

      client.data.userId = user.id;
      client.data.role = user.role;
      await client.join(`user:${user.id}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'erreur inconnue';

      this.logger.warn(`Connexion refusée [${client.id}]: ${message}`);
      // Jeton refusé (et non Auth indisponible) : le client ne doit pas
      // retenter indéfiniment avec ce jeton, il vérifie sa session.
      if (estJetonRefuse(error)) client.emit('session.revoquee');
      client.disconnect(true);
      return;
    }
    await this.envoyerInstantanePresence(client);
    client.emit('connexion.prete');
  }

  /**
   * Présences en direct pour un client qui vient de se connecter : il n'a
   * reçu aucun `presence.changed` passé (notamment les « hors ligne » de
   * ceux qui ont quitté juste avant). Liste des utilisateurs dont au moins un
   * socket a annoncé « en ligne ». Sans adaptateur Redis de Socket.IO,
   * `fetchSockets()` ne voit que les clients de CETTE instance : suffisant
   * tant que Message-Service tourne en une seule instance (Infra).
   * Best-effort : un échec ne coupe pas la connexion.
   */
  private async envoyerInstantanePresence(
    client: AuthenticatedSocket,
  ): Promise<void> {
    try {
      const sockets = await this.server.fetchSockets();
      const enLigne = new Set<string>();
      for (const socket of sockets) {
        const data = socket.data as SocketData;
        if (data.userId && data.presence === 'en-ligne') {
          enLigne.add(data.userId);
        }
      }
      client.emit('presence.snapshot', { enLigne: [...enLigne] });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'erreur inconnue';
      this.logger.warn(`Instantané de présence non envoyé: ${message}`);
    }
  }

  /**
   * Dernier socket d'un utilisateur fermé (app quittée, plantage, réseau
   * coupé) : il est aussitôt signalé hors ligne aux autres, sans attendre
   * l'expiration de son signe de vie côté User-Config-Service (~90 s).
   */
  async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
    this.logger.debug(`Client déconnecté: ${client.id}`);
    // Un envoi de profil différé part quand même : le changement a bien eu
    // lieu, seul le socket est parti.
    this.limitesProfil.delete(client.id);
    const userId = client.data?.userId;
    if (!userId) return;

    try {
      const restants = await this.server.in(`user:${userId}`).fetchSockets();
      if (restants.length > 0) return;
      await this.redis.publish(PRESENCE_CHANNEL, {
        userId,
        statut: 'hors-ligne',
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'erreur inconnue';
      this.logger.warn(`Présence hors ligne non diffusée: ${message}`);
    }
  }

  /**
   * Présence choisie par l'utilisateur, déjà enregistrée par le client dans
   * User-Config-Service : relayée tout de suite aux autres clients. Un
   * utilisateur ne peut annoncer que SA présence (identité du socket).
   */
  /**
   * Profil public modifié par l'utilisateur (alias, avatar, pseudo), déjà
   * enregistré par le client : les autres rechargent ce profil. Aucune
   * donnée n'est transmise, seulement l'identifiant (celui du socket).
   */
  @SubscribeMessage('profil.update')
  async updateProfil(
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<{ ok: true }> {
    const userId = this.requireUserId(client);
    const maintenant = Date.now();
    const limite = this.limitesProfil.get(client.id);
    if (!limite || maintenant - limite.dernierEnvoi >= DELAI_MIN_PROFIL_MS) {
      this.limitesProfil.set(client.id, { dernierEnvoi: maintenant });
      await this.redis.publish(PROFIL_CHANNEL, { userId });
      return { ok: true };
    }
    // Trop tôt : un seul envoi différé à la fin de la fenêtre, quel que soit
    // le nombre de demandes entre-temps.
    limite.envoiDiffere ??= setTimeout(
      () => {
        limite.envoiDiffere = undefined;
        limite.dernierEnvoi = Date.now();
        this.redis.publish(PROFIL_CHANNEL, { userId }).catch((erreur) => {
          this.logger.warn(`Profil non diffusé: ${String(erreur)}`);
        });
      },
      DELAI_MIN_PROFIL_MS - (maintenant - limite.dernierEnvoi),
    );
    return { ok: true };
  }

  @SubscribeMessage('presence.update')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async updatePresence(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: PresenceDto,
  ): Promise<{ ok: true }> {
    const userId = this.requireUserId(client);
    client.data.presence = dto.statut;
    await this.redis.publish(PRESENCE_CHANNEL, {
      userId,
      statut: dto.statut,
    });
    return { ok: true };
  }

  @SubscribeMessage('private-message.send')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async send(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: CreateMessageDto,
  ): Promise<PrivateMessage> {
    const senderId = this.requireUserId(client);

    return this.messages.create(senderId, dto);
  }

  @SubscribeMessage('room-message.join')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async joinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: RoomIdDto,
  ): Promise<{ joined: true }> {
    const acteur = this.requireActeur(client);

    const acces = await this.rooms.verifierAcces(dto.roomId, acteur);
    if (!acces.peutLire) {
      throw new WsException(
        'Vous devez être membre du salon pour rejoindre ce salon',
      );
    }

    await client.join(`room:${dto.roomId}`);
    client.data.salons = {
      ...client.data.salons,
      [dto.roomId]: acces.serveurId,
    };
    return { joined: true };
  }

  @SubscribeMessage('room-message.leave')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async leaveRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: RoomIdDto,
  ): Promise<{ left: true }> {
    await client.leave(`room:${dto.roomId}`);
    delete client.data.salons?.[dto.roomId];
    return { left: true };
  }

  @SubscribeMessage('room-message.send')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async sendRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: SendRoomMessageDto,
  ): Promise<RoomMessage> {
    const acteur = this.requireActeur(client);

    return this.roomMessages.create(acteur, dto.roomId, {
      content: dto.content,
    });
  }

  @SubscribeMessage('typing')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  typing(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: TypingDto,
  ): void {
    const userId = this.requireUserId(client);

    // Événement purement éphémère : ni persisté, ni routé par Redis/Postgres.
    const room =
      dto.scope === 'room' ? `room:${dto.targetId}` : `user:${dto.targetId}`;

    // Dans un salon, seul un socket qui l'a rejoint (droits vérifiés par
    // joinRoom) peut signaler qu'il écrit : sinon, n'importe qui pourrait
    // afficher « X est en train d'écrire » dans un salon sans y avoir accès.
    if (dto.scope === 'room' && !client.rooms.has(room)) {
      return;
    }

    const maintenant = Date.now();
    const saisies = (client.data.saisies ??= {});
    const precedente = saisies[room];
    if (
      precedente?.isTyping === dto.isTyping &&
      maintenant - precedente.temps < DELAI_MIN_SAISIE_MS
    ) {
      return;
    }
    saisies[room] = { isTyping: dto.isTyping, temps: maintenant };

    client.to(room).emit('typing', {
      userId,
      scope: dto.scope,
      targetId: dto.targetId,
      isTyping: dto.isTyping,
    });
  }

  private requireActeur(client: AuthenticatedSocket): Acteur {
    return {
      id: this.requireUserId(client),
      // Toujours défini avec userId (voir handleConnection).
      role: client.data.role ?? 'utilisateur',
    };
  }

  private requireUserId(client: AuthenticatedSocket): string {
    const userId = client.data.userId;

    // Socket.IO peut recevoir un événement pendant que handleConnection()
    // termine la validation distante du JWT. On refuse alors explicitement
    // l'action : aucune écriture n'est possible avant l'authentification.
    if (!userId) {
      throw new WsException('Utilisateur non authentifié');
    }

    return userId;
  }

  private readSocketToken(client: { handshake: { auth: unknown } }): string {
    const auth: unknown = client.handshake.auth;

    if (typeof auth !== 'object' || auth === null || !('token' in auth)) {
      throw new WsException('Token JWT manquant');
    }

    const token = (auth as { token?: unknown }).token;

    if (typeof token !== 'string' || token.length === 0) {
      throw new WsException('Token JWT manquant');
    }

    return token;
  }

  private broadcastRedisEvent(channel: string, payload: string): void {
    if (PRIVATE_MESSAGE_CHANNELS.includes(channel)) {
      this.broadcastPrivateMessageEvent(channel, payload);
      return;
    }

    if (ROOM_MESSAGE_CHANNELS.includes(channel)) {
      this.broadcastRoomMessageEvent(channel, payload);
      return;
    }

    if (channel === PRESENCE_CHANNEL) {
      this.broadcastPresenceEvent(payload);
      return;
    }

    if (channel === PROFIL_CHANNEL) {
      this.broadcastProfilEvent(payload);
      return;
    }

    if (channel === SERVEUR_CHANNEL) {
      this.broadcastServeurEvent(payload);
      return;
    }

    this.logger.warn(`Canal Redis invalide ignoré: ${channel}`);
  }

  private broadcastPrivateMessageEvent(channel: string, payload: string): void {
    let message: PrivateMessageEvent;

    try {
      const parsed: unknown = JSON.parse(payload);

      if (!this.isPrivateMessageEvent(parsed)) {
        this.logger.warn(`Payload Redis invalide ignoré: ${payload}`);
        return;
      }

      message = parsed;
    } catch {
      this.logger.warn(`Événement Redis invalide ignoré: ${payload}`);
      return;
    }

    this.server.to(`user:${message.senderId}`).emit(channel, message);

    if (message.recipientId !== message.senderId) {
      this.server.to(`user:${message.recipientId}`).emit(channel, message);
    }
  }

  private broadcastRoomMessageEvent(channel: string, payload: string): void {
    let message: RoomMessageEvent;

    try {
      const parsed: unknown = JSON.parse(payload);

      if (!this.isRoomMessageEvent(parsed)) {
        this.logger.warn(`Payload Redis invalide ignoré: ${payload}`);
        return;
      }

      message = parsed;
    } catch {
      this.logger.warn(`Événement Redis invalide ignoré: ${payload}`);
      return;
    }

    this.server.to(`room:${message.roomId}`).emit(channel, message);
  }

  private lireJson(payload: string): unknown {
    try {
      return JSON.parse(payload);
    } catch {
      return undefined;
    }
  }

  private broadcastProfilEvent(payload: string): void {
    const event = this.lireJson(payload) as { userId?: unknown } | null;
    if (typeof event?.userId !== 'string') {
      this.logger.warn(`Payload Redis invalide ignoré: ${payload}`);
      return;
    }
    this.server.emit(PROFIL_CHANNEL, { userId: event.userId });
  }

  /** Relaie un changement de serveur à chacun des membres concernés. */
  private broadcastServeurEvent(payload: string): void {
    const event = this.lireJson(payload) as Partial<EvenementServeur> | null;
    if (
      typeof event?.serveurId !== 'string' ||
      !RAISONS_SERVEUR.includes(event.raison as RaisonServeur) ||
      (event.cibleId !== null && typeof event.cibleId !== 'string') ||
      !Array.isArray(event.utilisateurIds) ||
      !event.utilisateurIds.every((id) => typeof id === 'string')
    ) {
      this.logger.warn(`Payload Redis invalide ignoré: ${payload}`);
      return;
    }
    const message = {
      serveurId: event.serveurId,
      raison: event.raison,
      cibleId: event.cibleId,
    };
    for (const userId of event.utilisateurIds) {
      this.server.to(`user:${userId}`).emit(SERVEUR_CHANNEL, message);
    }
    // Avant la revérification ci-dessous : elle doit interroger Room-Service,
    // pas le cache.
    this.rooms.oublierServeur(event.serveurId);
    this.revoquerAccesPerdus(event as EvenementServeur).catch(
      (erreur: unknown) => {
        this.logger.error(
          `Révocation des salons impossible: ${String(erreur)}`,
        );
      },
    );
  }

  /**
   * Retire des salons Socket.IO les sockets qui viennent d'en perdre
   * l'accès. Sans ça, un membre expulsé (ou dont le salon devient réservé
   * aux modérateurs) continuait de recevoir les messages en direct jusqu'à
   * sa reconnexion, puisque les droits ne sont vérifiés qu'au
   * `room-message.join`. Room-Service reste la seule source de vérité :
   * on lui redemande l'accès, uniquement pour les utilisateurs concernés et
   * les salons de ce serveur.
   */
  private async revoquerAccesPerdus(event: EvenementServeur): Promise<void> {
    for (const userId of utilisateursARevalider(event)) {
      // `server` n'est pas typé par événement (voir broadcast*) : on
      // retrouve ici le type des données posées sur nos sockets.
      const sockets = (await this.server
        .in(`user:${userId}`)
        .fetchSockets()) as unknown as RemoteSocket<
        EvenementsVersClient,
        SocketData
      >[];
      for (const socket of sockets) {
        const salons = socket.data.salons ?? {};
        for (const [salonId, serveurId] of Object.entries(salons)) {
          if (serveurId !== event.serveurId) continue;
          if (
            event.raison !== 'supprime' &&
            (await this.peutEncoreLire(salonId, {
              id: userId,
              role: socket.data.role ?? 'utilisateur',
            }))
          ) {
            continue;
          }
          socket.leave(`room:${salonId}`);
          delete salons[salonId];
          socket.emit('room-message.revoked', { roomId: salonId });
        }
      }
    }
  }

  /** Accès toujours valide ? En cas de doute (salon supprimé, Room-Service
   * indisponible), non : le client pourra rejoindre de nouveau. */
  private async peutEncoreLire(
    salonId: string,
    acteur: Acteur,
  ): Promise<boolean> {
    try {
      const acces = await this.rooms.verifierAcces(salonId, acteur);
      return acces.peutLire;
    } catch {
      return false;
    }
  }

  private broadcastPresenceEvent(payload: string): void {
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      this.logger.warn(`Événement Redis invalide ignoré: ${payload}`);
      return;
    }

    const candidat = event as Partial<PresenceEvent> | null;
    if (
      typeof candidat?.userId !== 'string' ||
      (candidat.statut !== 'en-ligne' && candidat.statut !== 'hors-ligne')
    ) {
      this.logger.warn(`Payload Redis invalide ignoré: ${payload}`);
      return;
    }

    this.server.emit(PRESENCE_CHANNEL, {
      userId: candidat.userId,
      statut: candidat.statut,
    });
  }

  private isPrivateMessageEvent(value: unknown): value is PrivateMessageEvent {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const event = value as Record<string, unknown>;

    return (
      typeof event.id === 'string' &&
      typeof event.senderId === 'string' &&
      typeof event.recipientId === 'string'
    );
  }

  private isRoomMessageEvent(value: unknown): value is RoomMessageEvent {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const event = value as Record<string, unknown>;

    return (
      typeof event.id === 'string' &&
      typeof event.roomId === 'string' &&
      typeof event.authorId === 'string'
    );
  }
}
