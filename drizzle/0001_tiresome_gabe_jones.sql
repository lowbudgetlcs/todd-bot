DO $$ BEGIN
 CREATE TYPE "public"."aal_level" AS ENUM('aal1', 'aal2', 'aal3');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."action" AS ENUM('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'ERROR');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."code_challenge_method" AS ENUM('s256', 'plain');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."equality_op" AS ENUM('eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."factor_status" AS ENUM('unverified', 'verified');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."factor_type" AS ENUM('totp', 'webauthn', 'phone');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."key_status" AS ENUM('default', 'valid', 'invalid', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."key_type" AS ENUM('aead-ietf', 'aead-det', 'hmacsha512', 'hmacsha256', 'auth', 'shorthash', 'generichash', 'kdf', 'secretbox', 'secretstream', 'stream_xchacha20');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."one_time_token_type" AS ENUM('confirmation_token', 'reauthentication_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'phone_change_token');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP TABLE "performances";--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "fk_player";
--> statement-breakpoint
ALTER TABLE "games" DROP CONSTRAINT "fk_series";
--> statement-breakpoint
ALTER TABLE "games" DROP CONSTRAINT "fk_loser";
--> statement-breakpoint
ALTER TABLE "games" DROP CONSTRAINT "fk_result";
--> statement-breakpoint
ALTER TABLE "games" DROP CONSTRAINT "fk_winner";
--> statement-breakpoint
ALTER TABLE "players" DROP CONSTRAINT "fk_team";
--> statement-breakpoint
ALTER TABLE "schedules" DROP CONSTRAINT "fk_division";
--> statement-breakpoint
ALTER TABLE "schedules" DROP CONSTRAINT "fk_series";
--> statement-breakpoint
ALTER TABLE "series" DROP CONSTRAINT "fk_team1";
--> statement-breakpoint
ALTER TABLE "series" DROP CONSTRAINT "fk_team2";
--> statement-breakpoint
ALTER TABLE "standings" DROP CONSTRAINT "fk_team";
--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "fk_division";
--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "fk_captain";
--> statement-breakpoint
DROP INDEX IF EXISTS "divisions_lower_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "teams_lower_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "group_keys_lower_idx";--> statement-breakpoint
ALTER TABLE "results" ALTER COLUMN "short_code" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "results" ALTER COLUMN "game_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "results" ALTER COLUMN "game_map" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "divisions" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "short_code" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "series" ALTER COLUMN "team1_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ALTER COLUMN "team2_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "division_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "group_keys" ALTER COLUMN "id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "game_num" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "processed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "summoner_name" varchar(40);--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "winner_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "games" ADD CONSTRAINT "games_winner_id_teams_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "games" ADD CONSTRAINT "games_loser_id_teams_id_fk" FOREIGN KEY ("loser_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "games" ADD CONSTRAINT "games_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "games" ADD CONSTRAINT "games_result_id_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."results"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedules" ADD CONSTRAINT "schedules_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedules" ADD CONSTRAINT "schedules_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "series" ADD CONSTRAINT "series_team1_id_teams_id_fk" FOREIGN KEY ("team1_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "series" ADD CONSTRAINT "series_team2_id_teams_id_fk" FOREIGN KEY ("team2_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "series" ADD CONSTRAINT "series_winner_id_teams_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standings" ADD CONSTRAINT "standings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_captain_id_players_id_fk" FOREIGN KEY ("captain_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "players_primary_riot_puuid_idx" ON "players" USING btree ("primary_riot_puuid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "divisions_lower_idx" ON "divisions" USING btree (lower((name)::text));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_lower_idx" ON "teams" USING btree (lower((name)::text));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_keys_lower_idx" ON "group_keys" USING btree (lower((letter)::text));--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "uq_short_code" UNIQUE("short_code");--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_tournament_id_key" UNIQUE("tournament_id");--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_primary_riot_puuid_key" UNIQUE("primary_riot_puuid");--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_summoner_name_key" UNIQUE("summoner_name");--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_team1_id_team2_id_playoffs_key" UNIQUE("team1_id","team2_id","playoffs");