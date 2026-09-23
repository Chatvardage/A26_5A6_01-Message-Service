import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateRoomMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(4000) content!: string;
}
