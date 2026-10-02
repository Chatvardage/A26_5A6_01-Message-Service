import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAdminMessageDto {
  @ApiProperty({ format: 'uuid', description: 'Expéditeur désigné.' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  senderId!: string;

  @ApiProperty({ format: 'uuid', description: 'Destinataire du DM.' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  recipientId!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;
}
