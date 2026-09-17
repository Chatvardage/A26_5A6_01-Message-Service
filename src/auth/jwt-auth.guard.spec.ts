import { AuthenticatedRequest, JwtAuthGuard } from "./jwt-auth.guard";

describe("JwtAuthGuard", () => {
  it("validates bearer token through Auth and attaches the current user", async () => {
    const user: any = { id: "u1", pseudo: "Alice", role: "utilisateur" };
    const jwt: any = {
      bearerToken: jest.fn().mockReturnValue("token"),
      verifyToken: jest.fn().mockResolvedValue(user),
    };
    const guard = new JwtAuthGuard(jwt);
    const request = {
      headers: { authorization: "Bearer token" },
    } as AuthenticatedRequest;
    const context: any = {
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwt.bearerToken).toHaveBeenCalledWith("Bearer token");
    expect(jwt.verifyToken).toHaveBeenCalledWith("token");
    expect(request.auth).toBe(user);
  });
});
