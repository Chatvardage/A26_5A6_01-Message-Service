import { IsIn } from 'class-validator';

/** Présence choisie par l'utilisateur (déjà enregistrée dans User-Config). */
export class PresenceDto {
  @IsIn(['en-ligne', 'hors-ligne']) statut!: 'en-ligne' | 'hors-ligne';
}
