-- CreateEnum
CREATE TYPE "ErrProjectCountry" AS ENUM ('KSA', 'KUWAIT');

-- AlterTable
ALTER TABLE "ErrProject" ADD COLUMN     "country" "ErrProjectCountry" NOT NULL DEFAULT 'KUWAIT';
