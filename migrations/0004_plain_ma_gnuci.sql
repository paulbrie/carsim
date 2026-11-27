CREATE TABLE "exam_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp (3) with time zone NOT NULL,
	"agent" text NOT NULL,
	"agent_name" text NOT NULL,
	"name" text NOT NULL,
	"track" text NOT NULL,
	"ground" text NOT NULL,
	"vehicle" text NOT NULL,
	"time_s" double precision,
	"why" text,
	"seconds" double precision,
	"error" text,
	"status" integer NOT NULL,
	"ms" integer NOT NULL,
	"autopilot" text,
	"build" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"image" text,
	"first_at" timestamp (3) with time zone NOT NULL,
	"last_at" timestamp (3) with time zone NOT NULL,
	"sign_ins" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "exam_runs_at" ON "exam_runs" USING btree ("at");--> statement-breakpoint
CREATE INDEX "exam_runs_agent" ON "exam_runs" USING btree ("agent");--> statement-breakpoint
CREATE INDEX "users_last" ON "users" USING btree ("last_at");