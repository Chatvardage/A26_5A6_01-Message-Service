import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateMessageDto {
  @IsString() @IsNotEmpty() recipientId!: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) content!: string;
}
