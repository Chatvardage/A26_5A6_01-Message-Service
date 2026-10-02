import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class HistoryQueryDto {
  @ApiPropertyOptional({
    description: 'Identifiant du dernier message reçu (page suivante).',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class AdminHistoryQueryDto extends HistoryQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filtre les messages envoyés ou reçus par cet utilisateur.',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
