import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { ExceptionsWsFilter } from './exceptions-ws.filter';

describe('ExceptionsWsFilter', () => {
  const hote = () => {
    const client = { emit: jest.fn() };
    const host = {
      switchToWs: () => ({
        getClient: () => client,
        getPattern: () => 'private-message.send',
        getData: () => ({}),
      }),
    } as unknown as ArgumentsHost;
    return { client, host };
  };

  it.each([
    [
      'la limite d’envoi (message en chaîne)',
      new HttpException('Trop de messages', HttpStatus.TOO_MANY_REQUESTS),
      429,
      'Trop de messages',
    ],
    [
      'un destinataire introuvable',
      new NotFoundException('Destinataire introuvable'),
      404,
      'Destinataire introuvable',
    ],
    [
      'une erreur de validation (liste de messages)',
      new BadRequestException(['content must be a string']),
      400,
      ['content must be a string'],
    ],
  ])(
    'transmet le code et le message pour %s',
    (_cas, erreur, code, message) => {
      const { client, host } = hote();
      new ExceptionsWsFilter().catch(erreur, host);
      expect(client.emit).toHaveBeenCalledWith('exception', {
        status: 'error',
        statusCode: code,
        message,
      });
    },
  );

  it('laisse le comportement par défaut pour les autres erreurs', () => {
    const { client, host } = hote();
    const parDefaut = jest.spyOn(BaseWsExceptionFilter.prototype, 'catch');
    const erreur = new WsException('Utilisateur non authentifié');
    new ExceptionsWsFilter().catch(erreur, host);
    expect(parDefaut).toHaveBeenLastCalledWith(erreur, host);
    expect(client.emit).toHaveBeenCalledWith(
      'exception',
      expect.objectContaining({ message: 'Utilisateur non authentifié' }),
    );
  });
});
