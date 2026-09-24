import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { lireConfigClientAuth } from '../partage/client-auth';

/** Durée pendant laquelle un destinataire existant est mémorisé. */
export const DUREE_CACHE_DESTINATAIRE_MS = 10 * 60_000;
// Borne la mémoire du cache : au-delà, l'entrée AJOUTÉE la première est
// oubliée (FIFO, pas LRU : une lecture ne la rajeunit pas). Sans gravité :
// une entrée évincée coûte seulement un nouvel appel à Authentification.
export const TAILLE_MAX_CACHE_DESTINATAIRES = 10_000;

/**
 * Vérifie qu'un destinataire de message privé existe, auprès
 * d'Authentification (`GET /api/users/lookup`, ouverte à tout utilisateur
 * connecté, avec le jeton de l'expéditeur). Sans cette vérification, un
 * message pouvait viser n'importe quel UUID et rester en base pour toujours,
 * sans personne pour le lire.
 *
 * Un destinataire trouvé est mémorisé DUREE_CACHE_DESTINATAIRE_MS : un
 * échange ne coûte qu'un appel. Un compte supprimé est oublié aussitôt
 * (route interne, voir InternalDonneesController). Échec fermé : sans
 * réponse d'Authentification, le message est refusé (503).
 */
@Injectable()
export class DestinatairesService {
  private readonly config = lireConfigClientAuth();
  private readonly connus = new Map<string, number>();

  async exigerExistant(id: string, jeton: string): Promise<void> {
    const expireA = this.connus.get(id);
    if (expireA !== undefined) {
      if (expireA > Date.now()) return;
      this.connus.delete(id);
    }

    let reponse: Response;
    try {
      reponse = await fetch(
        new URL(
          `/api/users/lookup?ids=${encodeURIComponent(id)}`,
          this.config.urlService,
        ),
        {
          headers: { Authorization: `Bearer ${jeton}` },
          signal: AbortSignal.timeout(this.config.delaiMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Service d'authentification indisponible",
      );
    }
    if (reponse.status === 401 || reponse.status === 403) {
      throw new UnauthorizedException('Jeton invalide ou expiré');
    }
    if (!reponse.ok) {
      throw new ServiceUnavailableException(
        'Vérification du destinataire impossible',
      );
    }

    let trouves: unknown;
    try {
      trouves = await reponse.json();
    } catch {
      throw new BadGatewayException(
        "Réponse invalide du service d'authentification",
      );
    }
    if (!Array.isArray(trouves)) {
      throw new BadGatewayException(
        "Réponse invalide du service d'authentification",
      );
    }
    if (
      !trouves.some(
        (u: unknown) =>
          typeof u === 'object' &&
          u !== null &&
          (u as { id?: unknown }).id === id,
      )
    ) {
      throw new NotFoundException('Destinataire introuvable');
    }

    if (this.connus.size >= TAILLE_MAX_CACHE_DESTINATAIRES) {
      this.connus.delete(this.connus.keys().next().value as string);
    }
    this.connus.set(id, Date.now() + DUREE_CACHE_DESTINATAIRE_MS);
  }

  /** Compte supprimé : ne plus le considérer comme existant. */
  oublier(id: string): void {
    this.connus.delete(id);
  }
}
