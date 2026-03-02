-- AlterTable: add secondaryOwnerIds column to CommsThread
ALTER TABLE "CommsThread" ADD COLUMN "secondaryOwnerIds" TEXT NOT NULL DEFAULT '[]';
