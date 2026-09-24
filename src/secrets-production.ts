/**
 * Refuse de démarrer en production (`NODE_ENV=production`) avec un secret
 * absent, trop court ou égal à une valeur de DÉVELOPPEMENT connue (valeurs
 * par défaut de A26_5A6_01-Infra : `.env.example`, `docker-compose.yml`).
 * En local, rien ne change. Tous les problèmes sont listés d'un coup.
 * Même règle que Room-Service (src/common/secrets-production.ts).
 */

// Même plancher que JWT_SECRET côté Authentification (256 bits aléatoires).
// La valeur de développement de l'Infra (`chatvardage_internal_dev`, 24
// caractères) est donc refusée par la seule longueur.
export const LONGUEUR_MIN_JETON_INTERNE = 32;

const MOTS_DE_PASSE_BDD_DE_DEVELOPPEMENT = [
  'message_service_dev',
  'postgres',
  'chatvardage',
];
const MOTS_DE_PASSE_REDIS_DE_DEVELOPPEMENT = ['chatvardage_redis_dev'];

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

export function problemesSecretsProduction(env: NodeJS.ProcessEnv): string[] {
  if (env.NODE_ENV?.trim() !== 'production') return [];
  const problemes: string[] = [];

  const jeton = env.INTERNAL_SERVICE_TOKEN?.trim() ?? '';
  if (jeton.length < LONGUEUR_MIN_JETON_INTERNE) {
    problemes.push(
      `INTERNAL_SERVICE_TOKEN doit contenir au moins ${LONGUEUR_MIN_JETON_INTERNE} caractères`,
    );
  }

  const motDePasseBdd = motDePasseUrl(env.DATABASE_URL);
  if (
    motDePasseBdd &&
    MOTS_DE_PASSE_BDD_DE_DEVELOPPEMENT.includes(motDePasseBdd)
  ) {
    problemes.push(
      'le mot de passe de DATABASE_URL est une valeur de développement',
    );
  }

  const motDePasseRedis = motDePasseUrl(env.REDIS_URL);
  if (
    motDePasseRedis &&
    MOTS_DE_PASSE_REDIS_DE_DEVELOPPEMENT.includes(motDePasseRedis)
  ) {
    problemes.push(
      'le mot de passe de REDIS_URL est une valeur de développement',
    );
  }
  return problemes;
}

export function verifierSecretsProduction(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const problemes = problemesSecretsProduction(env);
  if (problemes.length > 0) {
    throw new Error(
      `Secrets de développement refusés en production (NODE_ENV=production) : ${problemes.join(' ; ')}`,
    );
  }
}
