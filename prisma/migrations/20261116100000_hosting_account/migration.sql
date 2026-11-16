-- CreateTable
CREATE TABLE "HostingAccount" (
    "key" TEXT NOT NULL,
    "paidUntil" DATE NOT NULL,
    "yearlyFee" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "note" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostingAccount_pkey" PRIMARY KEY ("key")
);
