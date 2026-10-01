import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAdminRoomMessageDto {
  @IsString() @IsNotEmpty() @IsUUID() authorId!: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) content!: string;
}
