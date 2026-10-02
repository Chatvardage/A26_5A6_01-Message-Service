import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAdminRoomMessageDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Auteur désigné, membre du salon.',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  authorId!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;
}
