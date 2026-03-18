-- AlterTable
ALTER TABLE "FlowTransition" ADD COLUMN     "requiredTodos" JSONB;

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "todos" JSONB;

-- AlterTable
ALTER TABLE "NodeSession" ADD COLUMN     "completedTodos" JSONB;
