import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';

// Au plus MAX_ENVOIS_PAR_FENETRE messages (privés et de salon confondus) par
// utilisateur sur une fenêtre glissante de FENETRE_ENVOI_MS : assez pour une
// conversation rapide, pas pour inonder un salon ou une boîte de réception.
export const MAX_ENVOIS_PAR_FENETRE = 10;
export const FENETRE_ENVOI_MS = 10_000;

/**
 * Limite de fréquence des envois de messages, par utilisateur. En mémoire :
 * suffisant tant que Message-Service tourne en une seule instance (voir
 * README, « Limites connues »).
 */
@Injectable()
export class LimiteEnvoiService implements OnModuleDestroy {
  // Horodatages des envois récents, par utilisateur (du plus ancien au plus
  // récent).
  private readonly envois = new Map<string, number[]>();
  private readonly nettoyage: ReturnType<typeof setInterval>;

  constructor() {
    // Oublie les utilisateurs inactifs, pour que la table ne grossisse pas.
    this.nettoyage = setInterval(() => this.nettoyer(), FENETRE_ENVOI_MS);
    this.nettoyage.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.nettoyage);
  }

  /** Enregistre un envoi, ou lève une 429 si la limite est atteinte. */
  verifier(userId: string, maintenant = Date.now()): void {
    const recents = (this.envois.get(userId) ?? []).filter(
      (temps) => maintenant - temps < FENETRE_ENVOI_MS,
    );
    if (recents.length >= MAX_ENVOIS_PAR_FENETRE) {
      this.envois.set(userId, recents);
      throw new HttpException(
        'Trop de messages envoyés, réessayez dans quelques secondes',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recents.push(maintenant);
    this.envois.set(userId, recents);
  }

  nettoyer(maintenant = Date.now()): void {
    for (const [userId, temps] of this.envois) {
      const dernier = temps[temps.length - 1];
      if (dernier === undefined || maintenant - dernier >= FENETRE_ENVOI_MS) {
        this.envois.delete(userId);
      }
    }
  }
}
