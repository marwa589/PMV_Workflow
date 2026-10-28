-- Tell the people who may upload the next document of a process when it is their turn.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROCESS_UPLOAD_READY';
ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'PROCESS_UPLOAD_READY';
