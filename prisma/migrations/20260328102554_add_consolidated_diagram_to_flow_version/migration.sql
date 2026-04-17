-- AlterTable
ALTER TABLE "FlowVersion" ADD COLUMN     "consolidatedDiagram" TEXT,
ADD COLUMN     "diagramApproved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "diagramModified" BOOLEAN NOT NULL DEFAULT false;
