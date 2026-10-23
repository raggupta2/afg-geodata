-- Per-transfer penalty used by the "recommended" sort: each journey is
-- ranked by final arrival + transfers * this many minutes.
ALTER TABLE "journey_routing_policies"
    ADD COLUMN "transfer_penalty_minutes" INTEGER NOT NULL DEFAULT 240;

ALTER TABLE "journey_routing_policies"
    ADD CONSTRAINT "journey_routing_policies_transfer_penalty_check" CHECK (
        "transfer_penalty_minutes" BETWEEN 0 AND 1440
    );
