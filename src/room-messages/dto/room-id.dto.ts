import { IsNotEmpty, IsString, IsUUID } from "class-validator";

export class RoomIdDto {
  @IsString() @IsNotEmpty() @IsUUID() roomId!: string;
}
