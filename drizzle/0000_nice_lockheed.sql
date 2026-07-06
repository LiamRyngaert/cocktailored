CREATE TABLE "admin_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"email" varchar(320),
	"consent_marketing" boolean DEFAULT false,
	"consent_third_party" boolean DEFAULT false,
	"consent_timestamp" timestamp,
	"consent_ip" varchar(64),
	"privacy_policy_version" varchar(16),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"category" varchar(64) NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"name" varchar(128),
	"email" varchar(320),
	"ip_address" varchar(64),
	"device_type" varchar(32),
	"country" varchar(64),
	"answers" jsonb NOT NULL,
	"flavor_profile" jsonb,
	"generated_recipes" jsonb,
	"selected_recipe_index" integer DEFAULT 0,
	"allergies" text,
	"is_custom" boolean DEFAULT false,
	"order_email" varchar(320),
	"order_phone" varchar(64),
	"order_submitted" boolean DEFAULT false NOT NULL,
	"webhook_sent" boolean DEFAULT false NOT NULL,
	"webhook_sent_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"reviewer_name" varchar(64) NOT NULL,
	"review_text" text NOT NULL,
	"rating" integer DEFAULT 5 NOT NULL,
	"avatar_url" text,
	"is_female" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" varchar(16) DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE INDEX "ingredients_available_idx" ON "ingredients" USING btree ("available");--> statement-breakpoint
CREATE INDEX "ingredients_category_idx" ON "ingredients" USING btree ("category");--> statement-breakpoint
CREATE INDEX "quiz_sessions_created_at_idx" ON "quiz_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "quiz_sessions_order_submitted_idx" ON "quiz_sessions" USING btree ("order_submitted");