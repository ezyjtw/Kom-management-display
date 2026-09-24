-- Phase 12 (spec §17.5): per-user client scoping. No rows = unrestricted (CONFIRM-CLIENT-SCOPING).
CREATE TABLE "UserClientScope" (
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,
    CONSTRAINT "UserClientScope_pkey" PRIMARY KEY ("userId","clientId")
);

CREATE INDEX "UserClientScope_clientId_idx" ON "UserClientScope"("clientId");

ALTER TABLE "UserClientScope" ADD CONSTRAINT "UserClientScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserClientScope" ADD CONSTRAINT "UserClientScope_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
