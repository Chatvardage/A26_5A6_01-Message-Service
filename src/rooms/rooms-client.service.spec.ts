import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { RoomsClientService } from "./rooms-client.service";

describe("RoomsClientService", () => {
  const originalFetch = global.fetch;
  let service: RoomsClientService;

  beforeEach(() => {
    service = new RoomsClientService();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.ROOM_SERVICE_URL;
    delete process.env.ROOM_SERVICE_TIMEOUT_MS;
  });

  it("fetches a room through Room-Service", async () => {
    process.env.ROOM_SERVICE_URL = "http://room-service:3003/";
    const room = {
      type: "salon",
      id: "r1",
      nom: "General",
      visibilite: "public",
      membreIds: ["u1", "u2"],
      membresInvites: [],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => room,
    });

    await expect(service.getRoom("r1")).resolves.toEqual(room);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://room-service:3003/api/rooms/r1",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it.each(["abc", "0", "-10"])(
    "falls back to the default timeout for invalid value %s",
    async (value) => {
      process.env.ROOM_SERVICE_TIMEOUT_MS = value;
      const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "r1", membreIds: [] }),
      });

      await service.getRoom("r1");

      expect(timeoutSpy).toHaveBeenCalledWith(3000);
      timeoutSpy.mockRestore();
    },
  );

  it("uses a valid configured timeout", async () => {
    process.env.ROOM_SERVICE_TIMEOUT_MS = "1500";
    const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "r1", membreIds: [] }),
    });

    await service.getRoom("r1");

    expect(timeoutSpy).toHaveBeenCalledWith(1500);
    timeoutSpy.mockRestore();
  });

  it("maps 404 to not found", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(service.getRoom("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("maps network errors to unavailable", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("down"));
    await expect(service.getRoom("r1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("maps other non-ok statuses to unavailable", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(service.getRoom("r1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("maps a non-JSON response to a bad gateway", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("invalid json");
      },
    });
    await expect(service.getRoom("r1")).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it.each([
    { membreIds: ["u1"] },
    { id: "r1", membreIds: "not-an-array" },
    { id: "r1", membreIds: [1, 2] },
  ])("maps an invalid room payload %# to a bad gateway", async (payload) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    });
    await expect(service.getRoom("r1")).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
