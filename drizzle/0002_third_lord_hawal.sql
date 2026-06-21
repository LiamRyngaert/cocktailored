ALTER TABLE `quiz_sessions` ADD `orderEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `quiz_sessions` ADD `orderPhone` varchar(64);--> statement-breakpoint
ALTER TABLE `quiz_sessions` ADD `orderSubmitted` boolean DEFAULT false NOT NULL;