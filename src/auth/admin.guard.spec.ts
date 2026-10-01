import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  const contexteRequete = (requete: object) =>
    ({
      switchToHttp: () => ({ getRequest: () => requete }),
    }) as unknown as ExecutionContext;
  const contexte = (role: string) =>
    contexteRequete({ auth: { id: 'x', role } });

  it('laisse passer un admin', () => {
    expect(new AdminGuard().canActivate(contexte('admin'))).toBe(true);
  });

  it.each(['utilisateur', 'moderateur'])('refuse le rôle %s', (role) => {
    expect(() => new AdminGuard().canActivate(contexte(role))).toThrow(
      ForbiddenException,
    );
  });

  it('refuse une requête sans req.auth (JwtAuthGuard absent)', () => {
    expect(() => new AdminGuard().canActivate(contexteRequete({}))).toThrow(
      ForbiddenException,
    );
  });
});
