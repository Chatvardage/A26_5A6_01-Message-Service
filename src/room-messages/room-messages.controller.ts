import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { RoomMessage } from "@prisma/client";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateRoomMessageDto } from "./dto/create-room-message.dto";
import { RoomHistoryQueryDto } from "./dto/room-history-query.dto";
import { UpdateRoomMessageDto } from "./dto/update-room-message.dto";
import { RoomMessagesService } from "./room-messages.service";

@Controller("messages/rooms")
@UseGuards(JwtAuthGuard)
export class RoomMessagesController {
  constructor(private readonly roomMessages: RoomMessagesService) {}

  @Post(":roomId")
  create(
    @Req() req: AuthenticatedRequest,
    @Param("roomId") roomId: string,
    @Body() dto: CreateRoomMessageDto,
  ): Promise<RoomMessage> {
    return this.roomMessages.create(req.auth.id, roomId, dto);
  }

  @Get(":roomId/history")
  history(
    @Req() req: AuthenticatedRequest,
    @Param("roomId") roomId: string,
    @Query() query: RoomHistoryQueryDto,
  ): Promise<RoomMessage[]> {
    return this.roomMessages.history(req.auth.id, roomId, query);
  }

  @Get(":roomId/:id")
  findOne(
    @Req() req: AuthenticatedRequest,
    @Param("roomId") roomId: string,
    @Param("id") id: string,
  ): Promise<RoomMessage> {
    return this.roomMessages.findOne(req.auth.id, roomId, id);
  }

  @Patch(":roomId/:id")
  update(
    @Req() req: AuthenticatedRequest,
    @Param("roomId") roomId: string,
    @Param("id") id: string,
    @Body() dto: UpdateRoomMessageDto,
  ): Promise<RoomMessage> {
    return this.roomMessages.update(req.auth.id, roomId, id, dto);
  }

  @Delete(":roomId/:id")
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param("roomId") roomId: string,
    @Param("id") id: string,
  ): Promise<{ deleted: true }> {
    await this.roomMessages.remove(req.auth.id, roomId, id);
    return { deleted: true };
  }
}
