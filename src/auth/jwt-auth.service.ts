import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

export type AuthenticatedUser = {
  id: string;
  pseudo: string;
  courriel: string;
  role: "admin" | "moderateur" | "utilisateur";
  cree_le: string;
  modifie_le: string;
};

@Injectable()
export class JwtAuthService {
  bearerToken(authorization?: string): string {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedException("Authorization Bearer requis");
    return match[1];
  }

  async verifyToken(token: string): Promise<AuthenticatedUser> {
    const baseUrl = (
      process.env.AUTH_SERVICE_URL ?? "http://localhost:3001"
    ).replace(/\/$/, "");
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Service d'authentification indisponible",
      );
    }
    if (response.status === 401)
      throw new UnauthorizedException("Jeton invalide, expiré ou révoqué");
    if (!response.ok)
      throw new ServiceUnavailableException(
        "Validation de l'authentification impossible",
      );
    const user = (await response.json()) as Partial<AuthenticatedUser>;
    if (!user.id || !user.role)
      throw new ServiceUnavailableException(
        "Réponse invalide du service d'authentification",
      );
    return user as AuthenticatedUser;
  }
}
