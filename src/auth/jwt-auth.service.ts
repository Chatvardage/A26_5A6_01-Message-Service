import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

export type AuthenticatedUser = {
  id: string;
  pseudo: string;
  courriel: string;
  role: "admin" | "moderateur" | "utilisateur";
};

@Injectable()
export class JwtAuthService {
  bearerToken(authorization?: string): string {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      throw new UnauthorizedException("Authorization Bearer requis");
    }

    return match[1];
  }

  async verifyToken(token: string): Promise<AuthenticatedUser> {
    const baseUrl = (
      process.env.AUTH_SERVICE_URL ?? "http://localhost:3001"
    ).replace(/\/$/, "");

    const configuredTimeout = Number(
      process.env.AUTH_SERVICE_TIMEOUT_MS ?? 3000,
    );
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 3000;

    let response: Response;

    try {
      response = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Service d'authentification indisponible",
      );
    }

    if (response.status === 401) {
      throw new UnauthorizedException("Jeton invalide, expiré ou révoqué");
    }

    if (response.status === 403) {
      throw new ForbiddenException(
        "Accès refusé par le service d’authentification",
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        "Validation de l'authentification impossible",
      );
    }

    let user: Partial<AuthenticatedUser>;

    try {
      user = (await response.json()) as Partial<AuthenticatedUser>;
    } catch {
      throw new ServiceUnavailableException(
        "Réponse invalide du service d'authentification",
      );
    }

    const validRoles: AuthenticatedUser["role"][] = [
      "admin",
      "moderateur",
      "utilisateur",
    ];

    if (
      typeof user.id !== "string" ||
      typeof user.pseudo !== "string" ||
      typeof user.courriel !== "string" ||
      typeof user.role !== "string" ||
      !validRoles.includes(user.role)
    ) {
      throw new ServiceUnavailableException(
        "Réponse invalide du service d'authentification",
      );
    }

    return user as AuthenticatedUser;
  }
}
