import { PickType } from '@nestjs/swagger';
import { RechercheQueryDto } from './recherche-query.dto';

/** Le résumé compte toutes les correspondances, sans curseur de messages. */
export class ResumeRechercheQueryDto extends PickType(RechercheQueryDto, [
  'q',
] as const) {}
