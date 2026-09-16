CREATE TABLE "PrivateMessage" (
  "id" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrivateMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrivateMessage_senderId_recipientId_createdAt_idx"
ON "PrivateMessage"("senderId", "recipientId", "createdAt");

CREATE INDEX "PrivateMessage_recipientId_senderId_createdAt_idx"
ON "PrivateMessage"("recipientId", "senderId", "createdAt");
