import { MessagesGateway } from "./messages.gateway";
describe("MessagesGateway", () => {
  let messages: any, redis: any, g: MessagesGateway, to: any, emit: any;
  beforeEach(() => {
    messages = { create: jest.fn() };
    redis = { subscribe: jest.fn() };
    g = new MessagesGateway(messages, redis);
    emit = jest.fn();
    to = jest.fn(() => ({ emit }));
    (g as any).server = { to };
  });
  it("subscribes and broadcasts valid redis event to both users", async () => {
    let handler: any;
    redis.subscribe.mockImplementation(async (_c: any, h: any) => {
      handler = h;
    });
    await g.afterInit();
    handler(
      "private-message.created",
      JSON.stringify({ senderId: "u1", recipientId: "u2", id: "m" }),
    );
    expect(to).toHaveBeenCalledWith("user:u1");
    expect(to).toHaveBeenCalledWith("user:u2");
    expect(emit).toHaveBeenCalledTimes(2);
  });
  it("emits once for self-message", async () => {
    let h: any;
    redis.subscribe.mockImplementation(async (_c: any, x: any) => (h = x));
    await g.afterInit();
    h(
      "private-message.created",
      JSON.stringify({ senderId: "u1", recipientId: "u1" }),
    );
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it("ignores invalid routed event", async () => {
    let h: any;
    redis.subscribe.mockImplementation(async (_c: any, x: any) => (h = x));
    await g.afterInit();
    h("x", JSON.stringify({ senderId: "u1" }));
    expect(emit).not.toHaveBeenCalled();
  });
  it("ignores invalid json", async () => {
    let h: any;
    redis.subscribe.mockImplementation(async (_c: any, x: any) => (h = x));
    await g.afterInit();
    h("x", "{");
    expect(emit).not.toHaveBeenCalled();
  });
  it("disconnects connection without user", () => {
    const c: any = {
      handshake: { auth: {} },
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    g.handleConnection(c);
    expect(c.disconnect).toHaveBeenCalled();
    expect(c.join).not.toHaveBeenCalled();
  });
  it("joins user room", () => {
    const c: any = {
      handshake: { auth: { userId: "u1" } },
      disconnect: jest.fn(),
      join: jest.fn(),
    };
    g.handleConnection(c);
    expect(c.join).toHaveBeenCalledWith("user:u1");
  });
  it("send ignores missing sender", async () => {
    const c: any = { handshake: { auth: {} } };
    await g.send(c, { recipientId: "u2", content: "x" });
    expect(messages.create).not.toHaveBeenCalled();
  });
  it("send delegates create", async () => {
    messages.create.mockResolvedValue({});
    const c: any = { handshake: { auth: { userId: "u1" } } };
    await g.send(c, { recipientId: "u2", content: "x" });
    expect(messages.create).toHaveBeenCalledWith("u1", {
      recipientId: "u2",
      content: "x",
    });
  });
});
