ALTER TABLE "Room" ADD COLUMN "discoverable" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SearchCache" (
  "key" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "pageToken" TEXT,
  "response" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchCache_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "SearchCache_expiresAt_idx" ON "SearchCache"("expiresAt");
