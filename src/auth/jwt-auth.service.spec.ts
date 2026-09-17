import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtAuthService } from "./jwt-auth.service";

describe("JwtAuthService", () => {
  const originalFetch = global.fetch;
  let service: JwtAuthService;
  beforeEach(() => {
    service = new JwtAuthService();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AUTH_SERVICE_URL;
  });

  it("extracts a Bearer token", () => {
    expect(service.bearerToken("Bearer abc")).toBe("abc");
  });
  it.each([undefined, "Basic abc"])(
    "rejects invalid authorization %p",
    (header) => {
      expect(() => service.bearerToken(header)).toThrow(UnauthorizedException);
    },
  );
  it("validates through the final Auth service", async () => {
    process.env.AUTH_SERVICE_URL = "http://auth-service:3001/";
    const user = {
      id: "u1",
      pseudo: "Alice",
      courriel: "a@b.ca",
      role: "utilisateur",
      cree_le: "x",
      modifie_le: "x",
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => user,
    });
    await expect(service.verifyToken("jwt")).resolves.toEqual(user);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://auth-service:3001/api/auth/me",
      expect.objectContaining({ headers: { Authorization: "Bearer jwt" } }),
    );
  });
  it("maps 401 to unauthorized", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(service.verifyToken("bad")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it("maps network errors to unavailable", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("down"));
    await expect(service.verifyToken("jwt")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it("rejects other Auth errors", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(service.verifyToken("jwt")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it("rejects a non-JSON Auth response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("invalid json");
      },
    });
    await expect(service.verifyToken("jwt")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it.each([
    { id: "u1", role: "utilisateur", courriel: "a@b.ca" },
    { id: "u1", role: "utilisateur", pseudo: "Alice" },
  ])("rejects incomplete Auth user %#", async (user) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => user,
    });
    await expect(service.verifyToken("jwt")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("rejects malformed Auth response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "u1" }),
    });
    await expect(service.verifyToken("jwt")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
