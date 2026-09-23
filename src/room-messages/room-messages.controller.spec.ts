import { RoomMessagesController } from "./room-messages.controller";

describe("RoomMessagesController", () => {
  let service: any;
  let controller: RoomMessagesController;
  const req: any = { auth: { id: "u1" } };

  beforeEach(() => {
    service = {
      create: jest.fn(),
      history: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new RoomMessagesController(service);
  });

  it("delegates authenticated CRUD operations", async () => {
    const query = { limit: 50 };
    service.create.mockResolvedValue(1);
    service.history.mockResolvedValue([]);
    service.findOne.mockResolvedValue(1);
    service.update.mockResolvedValue(1);
    service.remove.mockResolvedValue(undefined);

    expect(await controller.create(req, "r1", { content: "x" })).toBe(1);
    expect(await controller.history(req, "r1", query)).toEqual([]);
    expect(await controller.findOne(req, "r1", "m")).toBe(1);
    expect(await controller.update(req, "r1", "m", { content: "y" })).toBe(1);
    expect(await controller.remove(req, "r1", "m")).toEqual({ deleted: true });

    expect(service.create).toHaveBeenCalledWith("u1", "r1", { content: "x" });
    expect(service.history).toHaveBeenCalledWith("u1", "r1", query);
    expect(service.findOne).toHaveBeenCalledWith("u1", "r1", "m");
    expect(service.update).toHaveBeenCalledWith("u1", "r1", "m", {
      content: "y",
    });
    expect(service.remove).toHaveBeenCalledWith("u1", "r1", "m");
  });
});
