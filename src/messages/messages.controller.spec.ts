import { ForbiddenException } from "@nestjs/common";
import { MessagesController } from "./messages.controller";

describe("MessagesController", () => {
  let service: any;
  let controller: MessagesController;
  const req: any = { auth: { id: "u1", role: "utilisateur" } };
  const adminReq: any = { auth: { id: "admin", role: "admin" } };

  beforeEach(() => {
    service = {
      create: jest.fn(),
      history: jest.fn(),
      findOne: jest.fn(),
      findAllForAdmin: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      removeForAdmin: jest.fn(),
    };
    controller = new MessagesController(service);
  });

  it("delegates authenticated CRUD operations", async () => {
    const query = { limit: 50 };
    service.create.mockResolvedValue(1);
    service.history.mockResolvedValue([]);
    service.findOne.mockResolvedValue(1);
    service.update.mockResolvedValue(1);
    service.remove.mockResolvedValue(undefined);

    expect(
      await controller.create(req, { recipientId: "u2", content: "x" }),
    ).toBe(1);
    expect(await controller.history(req, "u2", query)).toEqual([]);
    expect(await controller.findOne(req, "m")).toBe(1);
    expect(await controller.update(req, "m", { content: "y" })).toBe(1);
    expect(await controller.remove(req, "m")).toEqual({ deleted: true });

    expect(service.create).toHaveBeenCalledWith("u1", {
      recipientId: "u2",
      content: "x",
    });
    expect(service.history).toHaveBeenCalledWith("u1", "u2", query);
    expect(service.findOne).toHaveBeenCalledWith("u1", "m");
    expect(service.update).toHaveBeenCalledWith("u1", "m", { content: "y" });
    expect(service.remove).toHaveBeenCalledWith("u1", "m");
  });

  it("delegates moderation actions for an admin", async () => {
    service.create.mockResolvedValue(1);
    service.findAllForAdmin.mockResolvedValue([1]);
    service.removeForAdmin.mockResolvedValue(undefined);

    expect(await controller.createForAdmin(adminReq, {
      senderId: "u1",
      recipientId: "u2",
      content: "x",
    })).toBe(1);
    expect(await controller.findAllForAdmin(adminReq)).toEqual([1]);
    expect(await controller.removeForAdmin(adminReq, "m")).toEqual({
      deleted: true,
    });
    expect(service.create).toHaveBeenCalledWith("u1", {
      senderId: "u1",
      recipientId: "u2",
      content: "x",
    });
    expect(service.findAllForAdmin).toHaveBeenCalledWith();
    expect(service.removeForAdmin).toHaveBeenCalledWith("m");
  });

  it("refuses moderation actions for non-admin users", () => {
    expect(() => controller.findAllForAdmin(req)).toThrow(ForbiddenException);
    expect(() => controller.createForAdmin(req, {
      senderId: "u1",
      recipientId: "u2",
      content: "x",
    })).toThrow(ForbiddenException);
  });
});
