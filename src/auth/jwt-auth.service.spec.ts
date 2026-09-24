import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthService } from './jwt-auth.service';

// Le détail (configuration, cache, erreurs) est testé dans
// src/partage/client-auth.spec.ts.
describe('JwtAuthService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('extracts a Bearer token', () => {
    expect(new JwtAuthService().bearerToken('Bearer abc')).toBe('abc');
    expect(() => new JwtAuthService().bearerToken('Basic abc')).toThrow(
      UnauthorizedException,
    );
  });

  it('validates the token through Auth', async () => {
    const user = {
      id: 'u1',
      pseudo: 'alice',
      courriel: 'alice@example.com',
      role: 'utilisateur',
    };
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(user), { status: 200 }));

    await expect(new JwtAuthService().verifyToken('jwt')).resolves.toEqual(
      user,
    );
  });
});
