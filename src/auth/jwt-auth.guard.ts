import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { JwtAuthService, AuthClaims } from "./jwt-auth.service";

export type AuthenticatedRequest = Request & { auth: AuthClaims };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.jwt.bearerToken(request.headers.authorization);
    request.auth = this.jwt.verifyToken(token);
    return true;
  }
}
