import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** Raisons d'un changement de serveur, pour l'affichage côté client. */
export const RAISONS_SERVEUR = [
  'modifie', // serveur renommé, rendu public/privé, icône
  'supprime', // serveur supprimé
  'membres', // arrivée, départ, rôle modifié
  'expulse', // `cibleId` a été expulsé
  'invitation', // `cibleId` a été invité
  'salons', // salon créé, modifié ou supprimé
] as const;

export type RaisonServeur = (typeof RAISONS_SERVEUR)[number];

/**
 * Changement dans un serveur, envoyé par Room-Service : relayé en temps réel
 * à `utilisateurIds` (membres concernés, calculés par Room-Service), ou à
 * tous les clients connectés si `tous` (serveur par défaut, dont tout le
 * monde est membre : la liste de tous les comptes ne passe pas dans une
 * requête).
 */
export class EvenementServeurDto {
  @IsString() @IsNotEmpty() @MaxLength(255) serveurId!: string;

  @IsIn(RAISONS_SERVEUR) raison!: RaisonServeur;

  @IsOptional() @IsString() @MaxLength(255) cibleId?: string;

  @IsOptional() @IsBoolean() tous?: boolean;

  @ValidateIf((dto: EvenementServeurDto) => dto.tous !== true)
  @IsArray()
  @ArrayMaxSize(10_000)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  utilisateurIds?: string[];
}
