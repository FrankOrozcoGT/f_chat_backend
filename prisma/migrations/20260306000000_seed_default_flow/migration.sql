-- Create default router node
INSERT INTO "Node" ("id", "name", "systemPrompt", "onError", "createdAt", "updatedAt")
VALUES (
  'default-router-node',
  'Router',
  'Eres un asistente de voz amigable y conciso. Responde en español de forma natural y breve, como si estuvieras hablando por teléfono. Si el usuario envía una imagen, descríbela y responde a cualquier pregunta sobre ella. Si el usuario quiere hablar con un humano, responde con el intent "switch_hitl".',
  'hitl',
  NOW(),
  NOW()
);

-- Create a default flow for each existing user
INSERT INTO "Flow" ("id", "name", "routerNodeId", "userId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'Default',
  'default-router-node',
  "id",
  NOW(),
  NOW()
FROM "User";
