import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateRoomMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(4000) content!: string;
}
