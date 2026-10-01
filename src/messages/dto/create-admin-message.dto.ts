import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAdminMessageDto {
  @IsString() @IsNotEmpty() @IsUUID() senderId!: string;
  @IsString() @IsNotEmpty() @IsUUID() recipientId!: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) content!: string;
}
