-- Rotation state for the automated Connectify Library growth job.
CREATE TABLE "LibrarySeed" (
    "query" TEXT NOT NULL,
    "lastSearchedAt" TIMESTAMP(3),

    CONSTRAINT "LibrarySeed_pkey" PRIMARY KEY ("query")
);
