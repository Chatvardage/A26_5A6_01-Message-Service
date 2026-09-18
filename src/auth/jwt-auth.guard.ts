import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { AuthenticatedUser, JwtAuthService } from "./jwt-auth.service";

export type AuthenticatedRequest = Request & { auth: AuthenticatedUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtAuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.jwt.bearerToken(request.headers.authorization);
    request.auth = await this.jwt.verifyToken(token);
    return true;
  }
}
