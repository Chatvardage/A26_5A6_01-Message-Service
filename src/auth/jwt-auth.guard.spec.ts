import { JwtAuthGuard, AuthenticatedRequest } from "./jwt-auth.guard";

describe("JwtAuthGuard", () => {
  it("verifies bearer token and attaches claims", () => {
    const claims: any = {
      sub: "u1",
      pseudo: "Alice",
      role: "utilisateur",
      version_auth: 1,
      exp: 9999999999,
    };
    const jwt: any = {
      bearerToken: jest.fn().mockReturnValue("token"),
      verifyToken: jest.fn().mockReturnValue(claims),
    };
    const guard = new JwtAuthGuard(jwt);
    const request = {
      headers: { authorization: "Bearer token" },
    } as AuthenticatedRequest;
    const context: any = {
      switchToHttp: () => ({ getRequest: () => request }),
    };
    expect(guard.canActivate(context)).toBe(true);
    expect(jwt.bearerToken).toHaveBeenCalledWith("Bearer token");
    expect(jwt.verifyToken).toHaveBeenCalledWith("token");
    expect(request.auth).toBe(claims);
  });
});
