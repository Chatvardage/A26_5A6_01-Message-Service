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
} from '@nestjs/common';
import { RoomMessage } from '@prisma/client';
import { AdminGuard } from '../auth/admin.guard';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { extraireJetonBearer } from '../partage/client-auth';
import { CreateAdminRoomMessageDto } from './dto/create-admin-room-message.dto';
import { CreateRoomMessageDto } from './dto/create-room-message.dto';
import { RoomHistoryQueryDto } from './dto/room-history-query.dto';
import { UpdateRoomMessageDto } from './dto/update-room-message.dto';
import { RoomMessagesService } from './room-messages.service';

@Controller('messages/rooms')
@UseGuards(JwtAuthGuard)
export class RoomMessagesController {
  constructor(private readonly roomMessages: RoomMessagesService) {}

  @Post(':roomId')
  create(
    @Req() req: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Body() dto: CreateRoomMessageDto,
  ): Promise<RoomMessage> {
    return this.roomMessages.create(req.auth, roomId, dto);
  }

  @Post(':roomId/admin')
  @UseGuards(AdminGuard)
  createForAdmin(
    @Req() req: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Body() dto: CreateAdminRoomMessageDto,
  ): Promise<RoomMessage> {
    return this.roomMessages.createForAdmin(
      req.auth,
      roomId,
      dto,
      extraireJetonBearer(req.headers.authorization),
    );
  }

  @Get(':roomId/history')
  history(
    @Req() req: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Query() query: RoomHistoryQueryDto,
  ): Promise<RoomMessage[]> {
    return this.roomMessages.history(req.auth, roomId, query);
  }

  @Get(':roomId/:id')
  findOne(
    @Req() req: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Param('id') id: string,
  ): Promise<RoomMessage> {
    return this.roomMessages.findOne(req.auth, roomId, id);
  }

  @Patch(':roomId/:id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRoomMessageDto,
  ): Promise<RoomMessage> {
    return this.roomMessages.update(req.auth, roomId, id, dto);
  }

  @Delete(':roomId/:id')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    await this.roomMessages.remove(req.auth, roomId, id);
    return { deleted: true };
  }
}
