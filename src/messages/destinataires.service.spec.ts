import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  DestinatairesService,
  DUREE_CACHE_DESTINATAIRE_MS,
  TAILLE_MAX_CACHE_DESTINATAIRES,
} from './destinataires.service';

describe('DestinatairesService', () => {
  const originalFetch = global.fetch;
  const ancienneUrl = process.env.AUTH_SERVICE_URL;
  let fetchMock: jest.Mock;

  const repondre = (corps: unknown, status = 200) =>
    fetchMock.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => corps,
    });

  beforeEach(() => {
    process.env.AUTH_SERVICE_URL = 'http://auth:3001';
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    if (ancienneUrl === undefined) delete process.env.AUTH_SERVICE_URL;
    else process.env.AUTH_SERVICE_URL = ancienneUrl;
  });

  it("interroge /api/users/lookup avec le jeton de l'expéditeur", async () => {
    repondre([{ id: 'u2', pseudo: 'bob' }]);
    await new DestinatairesService().exigerExistant('u2', 'jwt');
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://auth:3001/api/users/lookup?ids=u2');
    expect(options.headers.Authorization).toBe('Bearer jwt');
  });

  it('refuse un destinataire inconnu (404), sans le mémoriser', async () => {
    repondre([]);
    const service = new DestinatairesService();
    await expect(service.exigerExistant('u9', 'jwt')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.exigerExistant('u9', 'jwt')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('mémorise un destinataire existant, puis le redemande après expiration', async () => {
    jest.useFakeTimers();
    repondre([{ id: 'u2', pseudo: 'bob' }]);
    const service = new DestinatairesService();
    await service.exigerExistant('u2', 'jwt');
    await service.exigerExistant('u2', 'jwt');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(DUREE_CACHE_DESTINATAIRE_MS + 1);
    await service.exigerExistant('u2', 'jwt');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('oublier : un compte supprimé est redemandé à Authentification', async () => {
    repondre([{ id: 'u2', pseudo: 'bob' }]);
    const service = new DestinatairesService();
    await service.exigerExistant('u2', 'jwt');
    service.oublier('u2');
    repondre([]);
    await expect(service.exigerExistant('u2', 'jwt')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("oublie l'entrée la plus ancienne quand le cache est plein", async () => {
    fetchMock.mockImplementation(async (url: URL) => ({
      ok: true,
      status: 200,
      json: async () => [{ id: url.searchParams.get('ids') }],
    }));
    const service = new DestinatairesService();
    for (let i = 0; i <= TAILLE_MAX_CACHE_DESTINATAIRES; i += 1) {
      await service.exigerExistant(`u${i}`, 'jwt');
    }
    await service.exigerExistant('u0', 'jwt');
    expect(fetchMock).toHaveBeenCalledTimes(TAILLE_MAX_CACHE_DESTINATAIRES + 2);
  });

  it.each([
    [401, UnauthorizedException],
    [403, UnauthorizedException],
    [500, ServiceUnavailableException],
  ])('réponse %i : %p', async (status, erreur) => {
    repondre({ erreur: 'x' }, status);
    await expect(
      new DestinatairesService().exigerExistant('u2', 'jwt'),
    ).rejects.toBeInstanceOf(erreur);
  });

  it('Authentification injoignable : 503 (échec fermé)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new DestinatairesService().exigerExistant('u2', 'jwt'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    ['un JSON illisible', () => Promise.reject(new SyntaxError('json'))],
    ['un objet au lieu d’un tableau', () => Promise.resolve({ id: 'u2' })],
  ])('réponse invalide (%s) : 502', async (_cas, json) => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json });
    await expect(
      new DestinatairesService().exigerExistant('u2', 'jwt'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('ignore les entrées mal formées de la réponse', async () => {
    repondre([null, 'u2', { pseudo: 'bob' }]);
    await expect(
      new DestinatairesService().exigerExistant('u2', 'jwt'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
