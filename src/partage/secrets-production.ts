// Fichier partagé : identique dans Room-Service, Message-Service et
// User-Config-Service (src/partage/). Le modifier dans les trois dépôts à la
// fois ; A26_5A6_01-Infra/scripts/verifier-fichiers-partages.sh le vérifie.

/**
 * Refuse de démarrer en production (`NODE_ENV=production`) avec un secret
 * absent, trop court ou égal à une valeur de DÉVELOPPEMENT connue (valeurs
 * par défaut de A26_5A6_01-Infra : `.env.example`, `docker-compose.yml`).
 * En local, rien ne change. Tous les problèmes sont listés d'un coup.
 */

// Même plancher que JWT_SECRET côté Authentification (256 bits aléatoires).
// La valeur de développement de l'Infra (`chatvardage_internal_dev`, 24
// caractères) est donc refusée par la seule longueur.
export const LONGUEUR_MIN_JETON_INTERNE = 32;

// Mots de passe de développement de l'Infra, tous services confondus
// (PostgreSQL et Redis) : un service ne doit réutiliser aucun d'eux.
export const MOTS_DE_PASSE_DE_DEVELOPPEMENT = [
  'postgres',
  'chatvardage',
  'auth_service_dev',
  'room_service_dev',
  'message_service_dev',
  'config_service_dev',
  'chatvardage_redis_dev',
];

/** Secrets exigés par un service donné. */
export type ExigencesSecrets = {
  /** INTERNAL_SERVICE_TOKEN (routes /api/internal entre services). */
  jetonInterne?: boolean;
  /** Variables contenant une URL avec mot de passe (ex. DATABASE_URL). */
  urlsAvecMotDePasse?: string[];
};

/** Mot de passe d'une URL de connexion, ou null (absent, URL invalide). */
export function motDePasseUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const motDePasse = new URL(url).password;
    return motDePasse ? decodeURIComponent(motDePasse) : null;
  } catch {
    return null;
  }
}

export function problemesSecretsProduction(
  exigences: ExigencesSecrets,
  env: NodeJS.ProcessEnv,
): string[] {
  if (env.NODE_ENV?.trim() !== 'production') return [];
  const problemes: string[] = [];

  if (exigences.jetonInterne) {
    const jeton = env.INTERNAL_SERVICE_TOKEN?.trim() ?? '';
    if (jeton.length < LONGUEUR_MIN_JETON_INTERNE) {
      problemes.push(
        `INTERNAL_SERVICE_TOKEN doit contenir au moins ${LONGUEUR_MIN_JETON_INTERNE} caractères`,
      );
    }
  }

  for (const variable of exigences.urlsAvecMotDePasse ?? []) {
    const motDePasse = motDePasseUrl(env[variable]);
    if (motDePasse && MOTS_DE_PASSE_DE_DEVELOPPEMENT.includes(motDePasse)) {
      problemes.push(
        `le mot de passe de ${variable} est une valeur de développement`,
      );
    }
  }
  return problemes;
}

export function verifierSecretsProduction(
  exigences: ExigencesSecrets,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const problemes = problemesSecretsProduction(exigences, env);
  if (problemes.length > 0) {
    throw new Error(
      `Secrets de développement refusés en production (NODE_ENV=production) : ${problemes.join(' ; ')}`,
    );
  }
}
