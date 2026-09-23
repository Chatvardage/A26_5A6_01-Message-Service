import { UnauthorizedException } from "@nestjs/common";
import { isAllowedOrigin, MessagesGateway } from "./messages.gateway";

describe("MessagesGateway", () => {
  it("accepts the default WebSocket CORS origin", () => {
    delete process.env.CORS_ORIGINS;
    const callback = jest.fn();

    isAllowedOrigin("http://localhost:5173", callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it("reads and filters configured WebSocket CORS origins at connection time", () => {
    process.env.CORS_ORIGINS = " http://one.test, ,http://two.test ";
    const callback = jest.fn();

    isAllowedOrigin("http://two.test", callback);

    expect(callback).toHaveBeenCalledWith(null, true);
    delete process.env.CORS_ORIGINS;
  });

  it("rejects an unknown WebSocket CORS origin", () => {
    process.env.CORS_ORIGINS = "http://allowed.test";
    const callback = jest.fn();

    isAllowedOrigin("http://blocked.test", callback);

    expect(callback).toHaveBeenCalledWith(null, false);
    delete process.env.CORS_ORIGINS;
  });

  it("accepts a WebSocket client without an Origin header", () => {
    const callback = jest.fn();

    isAllowedOrigin(undefined, callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  let messages: any;
  let redis: any;
  let jwt: any;
  let roomMessages: any;
  let rooms: any;
  let gateway: MessagesGateway;
  let emit: jest.Mock;
  let to: jest.Mock;

  beforeEach(() => {
    messages = { create: jest.fn() };
    redis = { subscribe: jest.fn() };
    jwt = { verifyToken: jest.fn() };
    roomMessages = { create: jest.fn() };
    rooms = { getRoom: jest.fn() };
    gateway = new MessagesGateway(messages, redis, jwt, roomMessages, rooms);
    emit = jest.fn();
    to = jest.fn(() => ({ emit }));
    (gateway as any).server = { to };
  });

  it("subscribes to all DM and room channels and broadcasts DM events to both users", async () => {
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
        "room-message.created",
        "room-message.updated",
        "room-message.deleted",
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

  it("ignores invalid JSON for a DM event", async () => {
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

  it("ignores a malformed DM Redis payload", async () => {
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

  it("broadcasts a room event to the room", async () => {
    let handler!: (channel: string, payload: string) => void;
    redis.subscribe.mockImplementation(
      async (_channels: string[], h: typeof handler) => {
        handler = h;
      },
    );
    await gateway.afterInit();
    handler(
      "room-message.created",
      JSON.stringify({ id: "m1", roomId: "r1", authorId: "u1" }),
    );
    expect(to).toHaveBeenCalledWith("room:r1");
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("ignores invalid JSON for a room event", async () => {
    let handler!: (channel: string, payload: string) => void;
    redis.subscribe.mockImplementation(
      async (_channels: string[], h: typeof handler) => {
        handler = h;
      },
    );
    await gateway.afterInit();
    handler("room-message.created", "{");
    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores a malformed room Redis payload", async () => {
    let handler!: (channel: string, payload: string) => void;
    redis.subscribe.mockImplementation(
      async (_channels: string[], h: typeof handler) => {
        handler = h;
      },
    );
    await gateway.afterInit();
    handler("room-message.created", JSON.stringify({ authorId: "u1" }));
    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores a null room Redis payload", async () => {
    let handler!: (channel: string, payload: string) => void;
    redis.subscribe.mockImplementation(
      async (_channels: string[], h: typeof handler) => {
        handler = h;
      },
    );
    await gateway.afterInit();
    handler("room-message.created", "null");
    expect(emit).not.toHaveBeenCalled();
  });

  it("disconnects when the socket token is missing", async () => {
    const client: any = {
      handshake: { auth: {} },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it("disconnects when JWT verification fails", async () => {
    jwt.verifyToken.mockRejectedValue(new UnauthorizedException());

    const client: any = {
      handshake: { auth: { token: "bad" } },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("disconnects when JWT verification throws a non-Error value", async () => {
    jwt.verifyToken.mockRejectedValue("failure");
    const client: any = {
      id: "socket-unknown-error",
      handshake: { auth: { token: "bad" } },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("verifies JWT and joins the authenticated user room", async () => {
    jwt.verifyToken.mockResolvedValue({ id: "u1" });
    const client: any = {
      handshake: { auth: { token: "jwt" } },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
    };
    await gateway.handleConnection(client);
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
  it("disconnects when socket auth is null", async () => {
    const client: any = {
      handshake: { auth: null },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it("disconnects when socket token is not a string", async () => {
    const client: any = {
      handshake: { auth: { token: 123 } },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it("disconnects when socket token is empty", async () => {
    const client: any = {
      handshake: { auth: { token: "" } },
      data: {},
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    await gateway.handleConnection(client);
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

  // --- room-message.join / leave / send ---

  it("refuses joining a room when the socket has no authenticated user", async () => {
    const client: any = { data: {} };
    await expect(gateway.joinRoom(client, { roomId: "r1" })).rejects.toThrow(
      "Utilisateur non authentifié",
    );
    expect(rooms.getRoom).not.toHaveBeenCalled();
  });

  it("refuses joining a room the caller is not a member of", async () => {
    rooms.getRoom.mockResolvedValue({ id: "r1", membreIds: ["u2"] });
    const client: any = { data: { userId: "u1" }, join: jest.fn() };

    await expect(gateway.joinRoom(client, { roomId: "r1" })).rejects.toThrow(
      "Vous devez être membre du salon pour rejoindre ce salon",
    );
    expect(client.join).not.toHaveBeenCalled();
  });

  it("joins the room's Socket.IO room for a member", async () => {
    rooms.getRoom.mockResolvedValue({ id: "r1", membreIds: ["u1"] });
    const client: any = {
      data: { userId: "u1" },
      join: jest.fn().mockResolvedValue(undefined),
    };

    await expect(gateway.joinRoom(client, { roomId: "r1" })).resolves.toEqual({
      joined: true,
    });
    expect(client.join).toHaveBeenCalledWith("room:r1");
  });

  it("leaves the room's Socket.IO room", async () => {
    const client: any = { leave: jest.fn().mockResolvedValue(undefined) };

    await expect(gateway.leaveRoom(client, { roomId: "r1" })).resolves.toEqual({
      left: true,
    });
    expect(client.leave).toHaveBeenCalledWith("room:r1");
  });

  it("refuses sending a room message when the socket has no authenticated user", async () => {
    const client: any = { data: {} };
    await expect(
      gateway.sendRoom(client, { roomId: "r1", content: "x" }),
    ).rejects.toThrow("Utilisateur non authentifié");
    expect(roomMessages.create).not.toHaveBeenCalled();
  });

  it("delegates sending a room message using the authenticated socket user", async () => {
    roomMessages.create.mockResolvedValue({ id: "m1" });
    const client: any = { data: { userId: "u1" } };

    await gateway.sendRoom(client, { roomId: "r1", content: "x" });
    expect(roomMessages.create).toHaveBeenCalledWith("u1", "r1", {
      content: "x",
    });
  });

  // --- typing ---

  it("refuses a typing event when the socket has no authenticated user", () => {
    const client: any = { data: {}, to: jest.fn() };
    expect(() =>
      gateway.typing(client, { scope: "room", targetId: "r1", isTyping: true }),
    ).toThrow("Utilisateur non authentifié");
    expect(client.to).not.toHaveBeenCalled();
  });

  it("relays a room-scoped typing event to the room", () => {
    const typingEmit = jest.fn();
    const client: any = {
      data: { userId: "u1" },
      to: jest.fn(() => ({ emit: typingEmit })),
    };

    gateway.typing(client, { scope: "room", targetId: "r1", isTyping: true });

    expect(client.to).toHaveBeenCalledWith("room:r1");
    expect(typingEmit).toHaveBeenCalledWith("typing", {
      userId: "u1",
      scope: "room",
      targetId: "r1",
      isTyping: true,
    });
  });

  it("relays a DM-scoped typing event to the target user", () => {
    const typingEmit = jest.fn();
    const client: any = {
      data: { userId: "u1" },
      to: jest.fn(() => ({ emit: typingEmit })),
    };

    gateway.typing(client, { scope: "dm", targetId: "u2", isTyping: false });

    expect(client.to).toHaveBeenCalledWith("user:u2");
    expect(typingEmit).toHaveBeenCalledWith("typing", {
      userId: "u1",
      scope: "dm",
      targetId: "u2",
      isTyping: false,
    });
  });
});
