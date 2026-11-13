-- Session revocation (audit finding H2): see User.tokenVersion in schema.prisma.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;
