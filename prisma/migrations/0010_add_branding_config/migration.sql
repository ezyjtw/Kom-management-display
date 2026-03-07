-- CreateTable
CREATE TABLE "BrandingConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "appName" TEXT NOT NULL DEFAULT 'KOMmand Centre',
    "subtitle" TEXT NOT NULL DEFAULT 'Ops Management & Comms Hub',
    "logoData" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandingConfig_pkey" PRIMARY KEY ("id")
);
