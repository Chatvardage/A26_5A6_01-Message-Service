import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { PrivateMessage } from "@prisma/client";
import { CreateMessageDto } from "./dto/create-message.dto";
import { UpdateMessageDto } from "./dto/update-message.dto";
import { MessagesService } from "./messages.service";

@Controller("messages")
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  create(
    @Headers("x-user-id") userId: string,
    @Body() dto: CreateMessageDto,
  ): Promise<PrivateMessage> {
    return this.messages.create(userId, dto);
  }

  @Get("history/:otherUserId")
  history(
    @Headers("x-user-id") userId: string,
    @Param("otherUserId") otherUserId: string,
  ): Promise<PrivateMessage[]> {
    return this.messages.history(userId, otherUserId);
  }

  @Get(":id")
  findOne(
    @Headers("x-user-id") userId: string,
    @Param("id") id: string,
  ): Promise<PrivateMessage> {
    return this.messages.findOne(userId, id);
  }

  @Patch(":id")
  update(
    @Headers("x-user-id") userId: string,
    @Param("id") id: string,
    @Body() dto: UpdateMessageDto,
  ): Promise<PrivateMessage> {
    return this.messages.update(userId, id, dto);
  }

  @Delete(":id")
  async remove(
    @Headers("x-user-id") userId: string,
    @Param("id") id: string,
  ): Promise<{ deleted: true }> {
    await this.messages.remove(userId, id);
    return { deleted: true };
  }
}
