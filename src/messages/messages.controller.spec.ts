import { MessagesController } from './messages.controller';

describe('MessagesController', () => {
  let service: any;
  let controller: MessagesController;
  const req: any = { auth: { id: 'u1' } };

  beforeEach(() => {
    service = {
      create: jest.fn(),
      history: jest.fn(),
      listConversations: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new MessagesController(service);
  });

  it('delegates authenticated CRUD operations', async () => {
    const query = { limit: 50 };
    service.create.mockResolvedValue(1);
    service.history.mockResolvedValue([]);
    service.listConversations.mockResolvedValue([]);
    service.findOne.mockResolvedValue(1);
    service.update.mockResolvedValue(1);
    service.remove.mockResolvedValue(undefined);

    expect(
      await controller.create(req, { recipientId: 'u2', content: 'x' }),
    ).toBe(1);
    expect(await controller.history(req, 'u2', query)).toEqual([]);
    expect(await controller.listConversations(req)).toEqual([]);
    expect(await controller.findOne(req, 'm')).toBe(1);
    expect(await controller.update(req, 'm', { content: 'y' })).toBe(1);
    expect(await controller.remove(req, 'm')).toEqual({ deleted: true });

    expect(service.create).toHaveBeenCalledWith('u1', {
      recipientId: 'u2',
      content: 'x',
    });
    expect(service.history).toHaveBeenCalledWith('u1', 'u2', query);
    expect(service.listConversations).toHaveBeenCalledWith('u1');
    expect(service.findOne).toHaveBeenCalledWith('u1', 'm');
    expect(service.update).toHaveBeenCalledWith('u1', 'm', { content: 'y' });
    expect(service.remove).toHaveBeenCalledWith('u1', 'm');
  });
});
