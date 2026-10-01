import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  const contexte = (role: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ auth: { id: 'x', role } }) }),
    }) as unknown as ExecutionContext;

  it('laisse passer un admin', () => {
    expect(new AdminGuard().canActivate(contexte('admin'))).toBe(true);
  });

  it.each(['utilisateur', 'moderateur'])('refuse le rôle %s', (role) => {
    expect(() => new AdminGuard().canActivate(contexte(role))).toThrow(
      ForbiddenException,
    );
  });
});
