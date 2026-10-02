import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateRoomMessageDto {
  @ApiProperty({ maxLength: 4000, example: 'Bonjour le salon!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;
}
