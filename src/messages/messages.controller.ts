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
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PrivateMessage } from '@prisma/client';
import { AdminGuard } from '../auth/admin.guard';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { extraireJetonBearer } from '../partage/client-auth';
import { ConversationSummary } from './dto/conversation-summary.dto';
import { CreateAdminMessageDto } from './dto/create-admin-message.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { AdminHistoryQueryDto, HistoryQueryDto } from './dto/history-query.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { MessagesService } from './messages.service';

@ApiTags('Messages privés')
@ApiBearerAuth()
@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  @ApiOperation({
    summary: 'Envoie un DM',
    description:
      'Écrit le message en base, puis publie `private-message.created` sur Redis.',
  })
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMessageDto,
  ): Promise<PrivateMessage> {
    return this.messages.create(
      req.auth.id,
      dto,
      // Déjà validé par JwtAuthGuard.
      extraireJetonBearer(req.headers.authorization),
    );
  }

  @Post('admin')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "Crée un DM au nom d'un utilisateur",
    description: 'Admin requis.',
  })
  @ApiForbiddenResponse({ description: 'Rôle admin requis' })
  createForAdmin(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateAdminMessageDto,
  ): Promise<PrivateMessage> {
    return this.messages.createForAdmin(
      dto,
      extraireJetonBearer(req.headers.authorization),
      req.auth.id,
    );
  }

  @Get('history/:otherUserId')
  @ApiOperation({
    summary: 'Historique de la conversation avec un utilisateur',
    description: 'Du plus récent au plus ancien, paginé par `cursor`.',
  })
  history(
    @Req() req: AuthenticatedRequest,
    @Param('otherUserId') otherUserId: string,
    @Query() query: HistoryQueryDto,
  ): Promise<PrivateMessage[]> {
    return this.messages.history(req.auth.id, otherUserId, query);
  }

  @Get('admin')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Liste tous les DM',
    description: 'Admin requis ; `userId` filtre par participant.',
  })
  @ApiForbiddenResponse({ description: 'Rôle admin requis' })
  findAllForAdmin(
    @Query() query: AdminHistoryQueryDto,
  ): Promise<PrivateMessage[]> {
    return this.messages.findAllForAdmin(query);
  }

  @Delete('admin/:id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Supprime un DM', description: 'Admin requis.' })
  @ApiForbiddenResponse({ description: 'Rôle admin requis' })
  async removeForAdmin(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    await this.messages.removeForAdmin(id, req.auth.id);
    return { deleted: true };
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'Mes conversations privées',
    description: 'Dernier message de chaque interlocuteur.',
  })
  listConversations(
    @Req() req: AuthenticatedRequest,
  ): Promise<ConversationSummary[]> {
    return this.messages.listConversations(req.auth.id);
  }

  // En dernier : Express essaie les routes dans l'ordre de déclaration,
  // ':id' capturerait sinon `admin` et `conversations`.
  @Get(':id')
  @ApiOperation({
    summary: "Lit un DM dont je suis l'expéditeur ou le destinataire",
  })
  findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<PrivateMessage> {
    return this.messages.findOne(req.auth.id, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Modifie un DM',
    description: 'Expéditeur seulement.',
  })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateMessageDto,
  ): Promise<PrivateMessage> {
    return this.messages.update(req.auth.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Supprime un DM',
    description: 'Expéditeur seulement.',
  })
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    await this.messages.remove(req.auth.id, id);
    return { deleted: true };
  }
}
