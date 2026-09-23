import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

export type Room = {
  type: string;
  id: string;
  nom: string;
  visibilite: string;
  membreIds: string[];
  membresInvites: string[];
};

@Injectable()
export class RoomsClientService {
  async getRoom(roomId: string): Promise<Room> {
    const baseUrl = (
      process.env.ROOM_SERVICE_URL ?? "http://localhost:3003"
    ).replace(/\/$/, "");

    const configuredTimeout = Number(
      process.env.ROOM_SERVICE_TIMEOUT_MS ?? 3000,
    );
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 3000;

    let response: Response;

    try {
      response = await fetch(`${baseUrl}/api/rooms/${roomId}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException("Service des salons indisponible");
    }

    if (response.status === 404) {
      throw new NotFoundException("Salon introuvable");
    }

    if (!response.ok) {
      throw new ServiceUnavailableException("Validation du salon impossible");
    }

    let room: Partial<Room>;

    try {
      room = (await response.json()) as Partial<Room>;
    } catch {
      throw new BadGatewayException("Réponse invalide du service des salons");
    }

    if (
      typeof room.id !== "string" ||
      !Array.isArray(room.membreIds) ||
      !room.membreIds.every((id) => typeof id === "string")
    ) {
      throw new BadGatewayException("Réponse invalide du service des salons");
    }

    return room as Room;
  }
}
