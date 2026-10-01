import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedRequest } from './jwt-auth.guard';

/** Routes d'administration. Après JwtAuthGuard, qui renseigne `req.auth`. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.auth.role !== 'admin') {
      throw new ForbiddenException('Role admin requis');
    }
    return true;
  }
}
