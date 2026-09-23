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
import { PrivateMessage } from "@prisma/client";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ConversationSummary } from "./dto/conversation-summary.dto";
import { CreateMessageDto } from "./dto/create-message.dto";
import { HistoryQueryDto } from "./dto/history-query.dto";
import { UpdateMessageDto } from "./dto/update-message.dto";
import { MessagesService } from "./messages.service";

@Controller("messages")
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMessageDto,
  ): Promise<PrivateMessage> {
    return this.messages.create(req.auth.id, dto);
  }

  @Get("history/:otherUserId")
  history(
    @Req() req: AuthenticatedRequest,
    @Param("otherUserId") otherUserId: string,
    @Query() query: HistoryQueryDto,
  ): Promise<PrivateMessage[]> {
    return this.messages.history(req.auth.id, otherUserId, query);
  }

  @Get("conversations")
  listConversations(
    @Req() req: AuthenticatedRequest,
  ): Promise<ConversationSummary[]> {
    return this.messages.listConversations(req.auth.id);
  }

  @Get(":id")
  findOne(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<PrivateMessage> {
    return this.messages.findOne(req.auth.id, id);
  }

  @Patch(":id")
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateMessageDto,
  ): Promise<PrivateMessage> {
    return this.messages.update(req.auth.id, id, dto);
  }

  @Delete(":id")
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<{ deleted: true }> {
    await this.messages.remove(req.auth.id, id);
    return { deleted: true };
  }
}
