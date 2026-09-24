import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class TypingDto {
  @IsIn(['room', 'dm']) scope!: 'room' | 'dm';
  @IsString() @IsNotEmpty() @MaxLength(255) targetId!: string;
  @IsBoolean() isTyping!: boolean;
}
