import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class UpdateMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(4000) content!: string;
}
