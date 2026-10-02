import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateMessageDto {
  @ApiProperty({ format: 'uuid', description: 'Destinataire du DM.' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  recipientId!: string;

  @ApiProperty({ maxLength: 4000, example: 'Salut!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;
}
