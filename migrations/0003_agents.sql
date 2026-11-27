CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_at" timestamp (3) with time zone NOT NULL,
	"claim_hash" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"created_from" text NOT NULL,
	"seen_at" timestamp (3) with time zone,
	"owner" text,
	"owner_name" text,
	"claimed_at" timestamp (3) with time zone,
	CONSTRAINT "agents_name_key_unique" UNIQUE("name_key"),
	CONSTRAINT "agents_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE INDEX "agents_owner" ON "agents" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "agents_created" ON "agents" USING btree ("created_at");