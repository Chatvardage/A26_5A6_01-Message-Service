import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';

/**
 * Erreurs des événements Socket.IO. Le filtre par défaut de NestJS ne
 * reconnaît que WsException : une HttpException (limite d'envoi 429,
 * destinataire introuvable 404, salon en lecture seule 403, validation 400…)
 * partait au client comme « Internal server error » et était journalisée
 * comme une erreur serveur. Elle est convertie ici : le client reçoit
 * l'événement `exception` `{ status: 'error', statusCode, message }`, avec le
 * même code et le même message qu'en REST. Une erreur 5xx (service appelé
 * indisponible…) reste journalisée côté serveur, comme avant. Le reste suit
 * le comportement par défaut.
 */
@Catch()
export class ExceptionsWsFilter extends BaseWsExceptionFilter {
  private readonly journal = new Logger(ExceptionsWsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException)) {
      super.catch(exception, host);
      return;
    }
    if (exception.getStatus() >= 500) {
      this.journal.error(
        `${host.switchToWs().getPattern()} : ${exception.getStatus()} ${exception.message}`,
      );
    }
    const reponse = exception.getResponse();
    const message =
      typeof reponse === 'object' && reponse !== null && 'message' in reponse
        ? reponse.message
        : exception.message;
    super.catch(
      new WsException({
        status: 'error',
        statusCode: exception.getStatus(),
        message,
      }),
      host,
    );
  }
}
