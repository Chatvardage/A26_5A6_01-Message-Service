import { IsBoolean, IsIn, IsNotEmpty, IsString } from 'class-validator';

export class TypingDto {
  @IsIn(['room', 'dm']) scope!: 'room' | 'dm';
  @IsString() @IsNotEmpty() targetId!: string;
  @IsBoolean() isTyping!: boolean;
}
