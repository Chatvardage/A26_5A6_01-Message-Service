import { UnauthorizedException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { JwtAuthService } from "./jwt-auth.service";

function token(
  secret: string,
  payload: Record<string, unknown>,
  alg = "HS256",
): string {
  const header = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

describe("JwtAuthService", () => {
  const secret = "12345678901234567890123456789012";
  let service: JwtAuthService;

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    service = new JwtAuthService();
  });

  afterEach(() => delete process.env.JWT_SECRET);

  it("verifies a valid HS256 token", () => {
    const jwt = token(secret, {
      sub: "u1",
      pseudo: "Alice",
      role: "utilisateur",
      version_auth: 1,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(service.verifyToken(jwt).sub).toBe("u1");
  });

  it("rejects missing or short secret", () => {
    delete process.env.JWT_SECRET;
    expect(() => service.verifyToken("x")).toThrow(UnauthorizedException);
  });

  it.each([
    ["bad format", "x"],
    ["wrong algorithm", token(secret, { sub: "u1", exp: 9999999999 }, "none")],
    ["expired", token(secret, { sub: "u1", exp: 1 })],
    ["missing subject", token(secret, { exp: 9999999999 })],
    [
      "bad signature",
      token("abcdefghijklmnopqrstuvwxyz123456", { sub: "u1", exp: 9999999999 }),
    ],
  ])("rejects %s", (_name, jwt) => {
    expect(() => service.verifyToken(jwt)).toThrow(UnauthorizedException);
  });

  it("extracts a Bearer token", () => {
    expect(service.bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("rejects a missing Bearer header", () => {
    expect(() => service.bearerToken()).toThrow(UnauthorizedException);
  });
  it("rejects a token containing an extra JWT part", () => {
    const jwt = token(secret, {
      sub: "u1",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(() => service.verifyToken(`${jwt}.extra`)).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a token with an invalid expiration value", () => {
    const jwt = token(secret, { sub: "u1", exp: "not-a-number" });
    expect(() => service.verifyToken(jwt)).toThrow(UnauthorizedException);
  });

  it("rejects an explicitly short JWT secret", () => {
    process.env.JWT_SECRET = "short";
    expect(() => service.verifyToken("x")).toThrow(UnauthorizedException);
  });

  it("rejects a non-Bearer authorization header", () => {
    expect(() => service.bearerToken("Basic abc")).toThrow(
      UnauthorizedException,
    );
  });
});
