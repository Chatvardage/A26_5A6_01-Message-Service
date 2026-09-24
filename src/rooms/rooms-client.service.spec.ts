import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { RoomsClientService } from "./rooms-client.service";

describe("RoomsClientService", () => {
  const originalFetch = global.fetch;
  const acteur = { id: "u1", role: "utilisateur" as const };
  const acces = {
    salonId: "r1",
    serveurId: "s1",
    estMembre: true,
    peutLire: true,
    peutEcrire: false,
  };
  let service: RoomsClientService;

  const repondre = (reponse: object) => {
    global.fetch = jest.fn().mockResolvedValue(reponse);
  };

  beforeEach(() => {
    service = new RoomsClientService();
    process.env.INTERNAL_SERVICE_TOKEN = "secret-interne";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.ROOM_SERVICE_URL;
    delete process.env.ROOM_SERVICE_TIMEOUT_MS;
    delete process.env.INTERNAL_SERVICE_TOKEN;
  });

  it("asks Room-Service's internal route with the shared token and the global role", async () => {
    process.env.ROOM_SERVICE_URL = "http://room-service:3003/";
    repondre({ ok: true, status: 200, json: async () => acces });

    await expect(
      service.verifierAcces("r 1", { id: "u/1", role: "admin" }),
    ).resolves.toEqual(acces);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://room-service:3003/api/internal/channels/r%201/access/u%2F1?role=admin",
      expect.objectContaining({
        headers: { "x-internal-token": "secret-interne" },
        signal: expect.anything(),
      }),
    );
  });

  it.each([undefined, "   "])(
    "refuses to call Room-Service without INTERNAL_SERVICE_TOKEN (%p)",
    async (valeur) => {
      if (valeur === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
      else process.env.INTERNAL_SERVICE_TOKEN = valeur;
      global.fetch = jest.fn();

      await expect(service.verifierAcces("r1", acteur)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["abc", "0", "-10"])(
    "falls back to the default timeout for invalid value %s",
    async (value) => {
      process.env.ROOM_SERVICE_TIMEOUT_MS = value;
      const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
      repondre({ ok: true, status: 200, json: async () => acces });

      await service.verifierAcces("r1", acteur);

      expect(timeoutSpy).toHaveBeenCalledWith(3000);
      timeoutSpy.mockRestore();
    },
  );

  it("uses a valid configured timeout", async () => {
    process.env.ROOM_SERVICE_TIMEOUT_MS = "1500";
    const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
    repondre({ ok: true, status: 200, json: async () => acces });

    await service.verifierAcces("r1", acteur);

    expect(timeoutSpy).toHaveBeenCalledWith(1500);
    timeoutSpy.mockRestore();
  });

  it("maps 404 to not found", async () => {
    repondre({ ok: false, status: 404 });
    await expect(
      service.verifierAcces("missing", acteur),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("maps network errors to unavailable", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("down"));
    await expect(service.verifierAcces("r1", acteur)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it.each([401, 500, 503])(
    "maps a %s status (e.g. wrong internal token) to unavailable",
    async (status) => {
      repondre({ ok: false, status });
      await expect(service.verifierAcces("r1", acteur)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    },
  );

  it("maps a non-JSON response to a bad gateway", async () => {
    repondre({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("invalid json");
      },
    });
    await expect(service.verifierAcces("r1", acteur)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it.each([
    { ...acces, salonId: 1 },
    { ...acces, serveurId: undefined },
    { ...acces, estMembre: "oui" },
    { ...acces, peutLire: null },
    { ...acces, peutEcrire: 1 },
  ])("maps an invalid access payload %# to a bad gateway", async (payload) => {
    repondre({ ok: true, status: 200, json: async () => payload });
    await expect(service.verifierAcces("r1", acteur)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
