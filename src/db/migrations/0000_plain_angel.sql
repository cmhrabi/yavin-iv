CREATE TYPE "public"."agent_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."gate_decision" AS ENUM('approved', 'rejected', 'regenerate');--> statement-breakpoint
CREATE TYPE "public"."gate_kind" AS ENUM('post_research', 'post_plan', 'pre_pr');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'researching', 'awaiting_research_approval', 'planning', 'reviewing_plan', 'awaiting_plan_approval', 'coding', 'reviewing_code', 'awaiting_pr_approval', 'opening_pr', 'completed', 'failed', 'cancelled', 'awaiting_human_intervention');--> statement-breakpoint
CREATE TYPE "public"."stage_kind" AS ENUM('research', 'plan', 'plan_review', 'code', 'code_review', 'pr');--> statement-breakpoint
CREATE TYPE "public"."stage_status" AS ENUM('pending', 'running', 'completed', 'failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."ticket_provider" AS ENUM('jira', 'linear', 'github');--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"role" "agent_role" NOT NULL,
	"content" jsonb NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"model" text,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_id" uuid,
	"seq" bigint NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gate_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"gate_kind" "gate_kind" NOT NULL,
	"decision" "gate_decision" NOT NULL,
	"feedback_text" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"repo_path" text NOT NULL,
	"base_branch" text DEFAULT 'main' NOT NULL,
	"branch_prefix" text DEFAULT 'rogue-one/' NOT NULL,
	"concurrency_limit" integer DEFAULT 1 NOT NULL,
	"ticket_providers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"github_repo" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_config_id" uuid NOT NULL,
	"ticket_provider" "ticket_provider" NOT NULL,
	"ticket_id" text NOT NULL,
	"ticket_url" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"branch_name" text,
	"worktree_path" text,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"current_stage" "stage_kind",
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" "stage_kind" NOT NULL,
	"status" "stage_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"output" jsonb,
	"error_text" text
);
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_repo_config_id_repo_configs_id_fk" FOREIGN KEY ("repo_config_id") REFERENCES "public"."repo_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_messages_run_id_idx" ON "agent_messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "events_run_id_idx" ON "events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "events_run_id_seq_idx" ON "events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "gate_decisions_run_id_idx" ON "gate_decisions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_repo_config_id_idx" ON "runs" USING btree ("repo_config_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stages_run_id_idx" ON "stages" USING btree ("run_id");