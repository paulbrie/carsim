CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autopilots" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner" text NOT NULL,
	"owner_name" text NOT NULL,
	"saved_at" timestamp (3) with time zone NOT NULL,
	"training" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maps" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"course" jsonb,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "records" (
	"map" text NOT NULL,
	"ground" text NOT NULL,
	"vehicle" text NOT NULL,
	"driver_id" text NOT NULL,
	"driver_name" text NOT NULL,
	"driver_image" text,
	"map_version" bigint NOT NULL,
	"time_s" double precision NOT NULL,
	"splits" jsonb NOT NULL,
	"set_at" timestamp (3) with time zone NOT NULL,
	"trace" text,
	CONSTRAINT "records_map_ground_vehicle_driver_id_pk" PRIMARY KEY("map","ground","vehicle","driver_id")
);
--> statement-breakpoint
CREATE INDEX "autopilots_owner" ON "autopilots" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "records_board" ON "records" USING btree ("map","ground","time_s");