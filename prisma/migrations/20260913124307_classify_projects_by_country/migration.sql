-- Classify specific projects as KSA
UPDATE "ErrProject" SET "country" = 'KSA' WHERE "name" IN ('AVK', 'AVR', 'KAFD', 'WP03');
