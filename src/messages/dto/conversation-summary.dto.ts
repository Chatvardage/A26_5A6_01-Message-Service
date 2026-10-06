import { PrivateMessage } from '@prisma/client';

export type ConversationSummary = {
  otherUserId: string;
  lastMessage: PrivateMessage;
  /** Messages reçus après le dernier marqué comme lu. */
  unreadCount: number;
};
