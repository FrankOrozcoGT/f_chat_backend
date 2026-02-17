const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw`
    SELECT "apiType", COUNT(*)::int as count, ROUND(SUM("costUsd")::numeric, 6)::float as total_cost
    FROM "ApiCall"
    GROUP BY "apiType"
    ORDER BY "apiType"
  `;

  console.log('\n=== API Calls Summary ===');
  console.table(result);

  // También verificar los últimos 5 registros de cada tipo
  console.log('\n=== Last 5 STT calls ===');
  const sttCalls = await prisma.apiCall.findMany({
    where: { apiType: 'qwen_stt' },
    select: {
      id: true,
      costUsd: true,
      calledAt: true,
      operation: true,
    },
    orderBy: { calledAt: 'desc' },
    take: 5,
  });
  console.table(sttCalls);

  console.log('\n=== Last 5 TTS calls ===');
  const ttsCalls = await prisma.apiCall.findMany({
    where: { apiType: 'qwen_tts' },
    select: {
      id: true,
      costUsd: true,
      calledAt: true,
      operation: true,
    },
    orderBy: { calledAt: 'desc' },
    take: 5,
  });
  console.table(ttsCalls);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
