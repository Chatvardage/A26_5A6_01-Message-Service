import {
  LONGUEUR_MIN_JETON_INTERNE,
  motDePasseUrl,
  problemesSecretsProduction,
  verifierSecretsProduction,
} from './secrets-production';

const JETON_SUR = 'x'.repeat(LONGUEUR_MIN_JETON_INTERNE);

describe('secrets de production', () => {
  const ENV_DEV = {
    INTERNAL_SERVICE_TOKEN: 'chatvardage_internal_dev',
    DATABASE_URL: 'postgresql://message_service:message_service_dev@db/m',
    REDIS_URL: 'redis://:chatvardage_redis_dev@redis:6379',
  };

  it('ne vérifie rien hors production (valeurs de développement acceptées)', () => {
    for (const NODE_ENV of [undefined, 'development', 'test']) {
      expect(problemesSecretsProduction({ ...ENV_DEV, NODE_ENV })).toEqual([]);
    }
  });

  it('accepte des secrets propres en production', () => {
    expect(() =>
      verifierSecretsProduction({
        NODE_ENV: ' production ',
        INTERNAL_SERVICE_TOKEN: JETON_SUR,
        DATABASE_URL: 'postgresql://message_service:vrai-secret@db/m',
        REDIS_URL: 'redis://:vrai-secret-redis@redis:6379',
      }),
    ).not.toThrow();
    // Sans DATABASE_URL/REDIS_URL (valeurs par défaut du code) : rien à dire.
    expect(
      problemesSecretsProduction({
        NODE_ENV: 'production',
        INTERNAL_SERVICE_TOKEN: JETON_SUR,
      }),
    ).toEqual([]);
  });

  it('refuse toutes les valeurs de développement, listées ensemble', () => {
    expect(
      problemesSecretsProduction({ ...ENV_DEV, NODE_ENV: 'production' }),
    ).toEqual([
      `INTERNAL_SERVICE_TOKEN doit contenir au moins ${LONGUEUR_MIN_JETON_INTERNE} caractères`,
      'le mot de passe de DATABASE_URL est une valeur de développement',
      'le mot de passe de REDIS_URL est une valeur de développement',
    ]);
    expect(() => verifierSecretsProduction({ NODE_ENV: 'production' })).toThrow(
      /NODE_ENV=production.*INTERNAL_SERVICE_TOKEN/,
    );
  });

  it('lit le mot de passe d’une URL de connexion', () => {
    expect(motDePasseUrl('redis://:p%40ss@h:6379')).toBe('p@ss');
    expect(motDePasseUrl('redis://h:6379')).toBeNull();
    expect(motDePasseUrl('pas une url')).toBeNull();
    expect(motDePasseUrl(undefined)).toBeNull();
  });

  it('utilise process.env par défaut', () => {
    const precedent = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      expect(() => verifierSecretsProduction()).not.toThrow();
    } finally {
      process.env.NODE_ENV = precedent;
    }
  });
});
