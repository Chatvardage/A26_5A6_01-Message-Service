import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

export type AuthClaims = {
  sub: string;
  pseudo: string;
  role: "admin" | "moderateur" | "utilisateur";
  version_auth: number;
  exp: number;
};

@Injectable()
export class JwtAuthService {
  verifyToken(token: string): AuthClaims {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32)
      throw new UnauthorizedException("Configuration JWT invalide");

    try {
      const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
      if (!headerPart || !payloadPart || !signaturePart || extra)
        throw new Error("format");

      const header = JSON.parse(
        Buffer.from(headerPart, "base64url").toString("utf8"),
      ) as { alg?: string };
      if (header.alg !== "HS256") throw new Error("algorithme");

      const expected = createHmac("sha256", secret)
        .update(`${headerPart}.${payloadPart}`)
        .digest();
      const received = Buffer.from(signaturePart, "base64url");
      if (
        received.length !== expected.length ||
        !timingSafeEqual(received, expected)
      )
        throw new Error("signature");

      const claims = JSON.parse(
        Buffer.from(payloadPart, "base64url").toString("utf8"),
      ) as AuthClaims;
      if (
        !claims.sub ||
        !Number.isFinite(claims.exp) ||
        claims.exp <= Math.floor(Date.now() / 1000)
      ) {
        throw new Error("claims");
      }
      return claims;
    } catch {
      throw new UnauthorizedException("Jeton invalide ou expiré");
    }
  }

  bearerToken(authorization?: string): string {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedException("Authorization Bearer requis");
    return match[1];
  }
}
