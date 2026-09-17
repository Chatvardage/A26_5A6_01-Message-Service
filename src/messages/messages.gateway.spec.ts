import { UnauthorizedException } from "@nestjs/common";
import { MessagesGateway } from "./messages.gateway";

describe("MessagesGateway", () => {
  let messages: any;
  let redis: any;
  let jwt: any;
  let gateway: MessagesGateway;
  let emit: jest.Mock;
  let to: jest.Mock;

  beforeEach(() => {
    messages = { create: jest.fn() };
    redis = { subscribe: jest.fn() };
    jwt = { verifyToken: jest.fn() };
    gateway = new MessagesGateway(messages, redis, jwt);
    emit = jest.fn();
    to = jest.fn(() => ({ emit }));
    (gateway as any).server = { to };
  });

  it("subscribes to all DM channels and broadcasts to both users", async () => {
    let handler!: (channel: string, payload: string) => void;
    redis.subscribe.mockImplementation(
      async (_channels: string[], h: typeof handler) => {
        handler = h;
      },
    );

    await gateway.afterInit();
    expect(redis.subscribe).toHaveBeenCalledWith(
      [
        "private-message.created",
        "private-message.updated",
        "private-message.deleted",
      ],
      expect.any(Function),
    );

    handler(
      "private-message.created",
      JSON.stringify({ id: "m1", senderId: "u1", recipientId: "u2" }),
    );
    expect(to).toHaveBeenCalledWith("user:u1");
    expect(to).toHaveBeenCalledWith("user:u2");
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("emits once for a self-message", async () => {
    let handler!: (channel: string, payload: string) => void;
    redis.subscribe.mockImplementation(
      async (_channels: string[], h: typeof handler) => {
        handler = h;
      },
    );
    await gateway.afterInit();
    handler(
      "private-message.created",
      JSON.stringify({ id: "m1", senderId: "u1", recipientId: "u1" }),
    );
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("ignores an invalid Redis channel", async () => {
    let handler!: (channel: string, payload: string) => void;
    redis.subscribe.mockImplementation(
      async (_channels: string[], h: typeof handler) => {
        handler = h;
      },
    );
    await gateway.afterInit();
    handler(
      "x",
      JSON.stringify({ id: "m1", senderId: "u1", recipientId: "u2" }),
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores invalid JSON", async () => {
    let handler!: (channel: string, payload: string) => void;
    redis.subscribe.mockImplementation(
      async (_channels: string[], h: typeof handler) => {
        handler = h;
      },
    );
    await gateway.afterInit();
    handler("private-message.created", "{");
    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores a malformed Redis payload", async () => {
    let handler!: (channel: string, payload: string) => void;
    redis.subscribe.mockImplementation(
      async (_channels: string[], h: typeof handler) => {
        handler = h;
      },
    );
    await gateway.afterInit();
    handler("private-message.created", JSON.stringify({ senderId: "u1" }));
    expect(emit).not.toHaveBeenCalled();
  });

  it("disconnects when the socket token is missing", () => {
    const client: any = {
      handshake: { auth: {} },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it("disconnects when JWT verification fails", () => {
    jwt.verifyToken.mockImplementation(() => {
      throw new UnauthorizedException();
    });
    const client: any = {
      handshake: { auth: { token: "bad" } },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("verifies JWT and joins the authenticated user room", () => {
    jwt.verifyToken.mockReturnValue({ sub: "u1" });
    const client: any = {
      handshake: { auth: { token: "jwt" } },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
    };
    gateway.handleConnection(client);
    expect(jwt.verifyToken).toHaveBeenCalledWith("jwt");
    expect(client.data.userId).toBe("u1");
    expect(client.join).toHaveBeenCalledWith("user:u1");
  });

  it("refuses sending when the socket has no authenticated user", async () => {
    const client: any = { data: {} };
    await expect(
      gateway.send(client, { recipientId: "u2", content: "x" }),
    ).rejects.toThrow("Utilisateur non authentifié");
    expect(messages.create).not.toHaveBeenCalled();
  });

  it("delegates sending using the authenticated socket user", async () => {
    messages.create.mockResolvedValue({ id: "m1" });
    const client: any = { data: { userId: "u1" } };
    await gateway.send(client, { recipientId: "u2", content: "x" });
    expect(messages.create).toHaveBeenCalledWith("u1", {
      recipientId: "u2",
      content: "x",
    });
  });

  it("logs disconnect without throwing", () => {
    expect(() =>
      gateway.handleDisconnect({ id: "socket-1" } as any),
    ).not.toThrow();
  });
  it("disconnects when socket auth is null", () => {
    const client: any = {
      handshake: { auth: null },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it("disconnects when socket token is not a string", () => {
    const client: any = {
      handshake: { auth: { token: 123 } },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it("disconnects when socket token is empty", () => {
    const client: any = {
      handshake: { auth: { token: "" } },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it.each([
    ["null payload", "null"],
    [
      "invalid id",
      JSON.stringify({ id: 123, senderId: "u1", recipientId: "u2" }),
    ],
    [
      "invalid sender",
      JSON.stringify({ id: "m1", senderId: 123, recipientId: "u2" }),
    ],
    [
      "invalid recipient",
      JSON.stringify({ id: "m1", senderId: "u1", recipientId: 123 }),
    ],
  ])("ignores %s from Redis", async (_name, payload) => {
    let handler!: (channel: string, payload: string) => void;
    redis.subscribe.mockImplementation(
      async (_channels: string[], h: typeof handler) => {
        handler = h;
      },
    );
    await gateway.afterInit();
    handler("private-message.created", payload);
    expect(emit).not.toHaveBeenCalled();
  });
});
