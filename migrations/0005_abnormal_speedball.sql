CREATE TABLE "arm_networks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner" text NOT NULL,
	"owner_name" text NOT NULL,
	"saved_at" timestamp (3) with time zone NOT NULL,
	"arm" text NOT NULL,
	"task" text NOT NULL,
	"weights" integer NOT NULL,
	"net" jsonb NOT NULL,
	"exam" jsonb
);
--> statement-breakpoint
CREATE INDEX "arm_networks_owner" ON "arm_networks" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "arm_networks_arm_task" ON "arm_networks" USING btree ("arm","task");