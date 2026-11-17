-- Per-user switch: when true, pending-task and ticket notification emails are not sent to this user.
ALTER TABLE "User" ADD COLUMN "emailNotificationsDisabled" BOOLEAN NOT NULL DEFAULT false;
