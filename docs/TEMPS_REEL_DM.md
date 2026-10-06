# Documentation du contrat

La référence est maintenue dans [Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/api/temps-reel-dm.md). Mettre cette référence à jour avec le code du service.

Les accusés `read-state.updated` transmettent `{ kind, targetId, userId, lastReadAt, lastReadMessageId }`. Conserver la position maximale `(date, identifiant)`; à date égale, une lecture ancienne sans identifiant couvre toute la milliseconde. Les routes HTTP des lecteurs exposent la même position.
