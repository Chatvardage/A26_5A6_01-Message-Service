CREATE TABLE "RoomMessage" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoomMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoomMessage_roomId_createdAt_idx"
ON "RoomMessage"("roomId", "createdAt");
