import { IsNotEmpty, IsString, IsUUID, MaxLength } from "class-validator";

export class SendRoomMessageDto {
  @IsString() @IsNotEmpty() @IsUUID() roomId!: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) content!: string;
}
