-- Smart Autoplay and Connectify Library contribution default on for every room, including existing ones.
ALTER TABLE "Room" ALTER COLUMN "autopilotEnabled" SET DEFAULT true;
ALTER TABLE "Room" ALTER COLUMN "discoverable" SET DEFAULT true;
UPDATE "Room" SET "autopilotEnabled" = true, "discoverable" = true;

-- Autopilot keeps this many upcoming songs ready before reviving room history.
ALTER TABLE "Room" ADD COLUMN "autoplayMinBuffer" INTEGER NOT NULL DEFAULT 4;

-- "Never play this again" excludes a track from autoplay revival.
ALTER TABLE "Track" ADD COLUMN "autoplayBlocked" BOOLEAN NOT NULL DEFAULT false;
