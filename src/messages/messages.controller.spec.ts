import { MessagesController } from "./messages.controller";
describe("MessagesController", () => {
  let s: any, c: MessagesController;
  beforeEach(() => {
    s = {
      create: jest.fn(),
      history: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    c = new MessagesController(s);
  });
  it("delegates CRUD", async () => {
    s.create.mockResolvedValue(1);
    s.history.mockResolvedValue([]);
    s.findOne.mockResolvedValue(1);
    s.update.mockResolvedValue(1);
    s.remove.mockResolvedValue(undefined);
    expect(await c.create("u1", { recipientId: "u2", content: "x" })).toBe(1);
    expect(await c.history("u1", "u2")).toEqual([]);
    expect(await c.findOne("u1", "m")).toBe(1);
    expect(await c.update("u1", "m", { content: "y" })).toBe(1);
    expect(await c.remove("u1", "m")).toEqual({ deleted: true });
  });
});
