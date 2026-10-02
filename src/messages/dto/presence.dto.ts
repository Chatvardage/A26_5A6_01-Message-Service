import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';

/** Présence choisie par l'utilisateur (déjà enregistrée dans User-Config). */
export class PresenceDto {
  @IsIn(['en-ligne', 'hors-ligne']) statut!: 'en-ligne' | 'hors-ligne';
}

/** Nombre maximal d'utilisateurs dont un socket suit la présence. */
export const MAX_PRESENCES_SUIVIES = 500;

/**
 * Utilisateurs dont le client veut connaître la présence (ceux qu'il
 * affiche). Remplace la liste précédente.
 */
export class SuivrePresenceDto {
  @IsArray()
  @ArrayMaxSize(MAX_PRESENCES_SUIVIES)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  ids!: string[];
}
