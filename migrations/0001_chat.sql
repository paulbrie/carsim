CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"user_image" text,
	"text" text NOT NULL,
	"at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_mutes" (
	"user_id" text PRIMARY KEY NOT NULL,
	"user_name" text NOT NULL,
	"until" timestamp (3) with time zone NOT NULL,
	"by" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_messages_at" ON "chat_messages" USING btree ("at");