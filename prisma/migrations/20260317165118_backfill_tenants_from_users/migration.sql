-- Migración 3: Backfill de Tenants desde Users existentes
-- Usa originUserId como pivot para joins seguros

-- 1. Crear un Tenant por cada User existente, guardando originUserId como pivot
INSERT INTO "Tenant" (id, name, "originUserId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), name, id, NOW(), NOW()
FROM "User";

-- 2. Crear TenantMember owner para cada User
INSERT INTO "TenantMember" (id, "tenantId", "userId", role, "createdAt", "updatedAt")
SELECT gen_random_uuid(), t.id, u.id, 'owner'::"TenantRole", NOW(), NOW()
FROM "User" u
JOIN "Tenant" t ON t."originUserId" = u.id;

-- 3. Crear TenantSettings por cada Tenant, copiando datos de User y UserSettings
INSERT INTO "TenantSettings" (
  id, "tenantId", plan, "whatsappLimit", "creditsLimit", "creditsUsed",
  "billingPeriodStart", "analysisMode", "messageLimit", "defaultShippingCost",
  "workSchedule", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  t.id,
  u.plan,
  u."whatsappLimit",
  u."creditsLimit",
  u."creditsUsed",
  u."billingPeriodStart",
  COALESCE(us."analysisMode", 'manual'::"AnalysisMode"),
  COALESCE(us."messageLimit", 30),
  COALESCE(us."defaultShippingCost", 0),
  COALESCE(us."workSchedule", '{"1":{"start":8,"end":18},"2":{"start":8,"end":18},"3":{"start":8,"end":18},"4":{"start":8,"end":18},"5":{"start":8,"end":18},"6":{"start":8,"end":12}}'::jsonb),
  NOW(),
  NOW()
FROM "User" u
JOIN "Tenant" t ON t."originUserId" = u.id
LEFT JOIN "UserSettings" us ON us."userId" = u.id;

-- 4. Actualizar tenantId en Phone
UPDATE "Phone" p
SET "tenantId" = t.id
FROM "Tenant" t
WHERE t."originUserId" = p."userId";

-- 5. Actualizar tenantId en Flow
UPDATE "Flow" f
SET "tenantId" = t.id
FROM "Tenant" t
WHERE t."originUserId" = f."userId";

-- 6. Actualizar tenantId en Intent
UPDATE "Intent" i
SET "tenantId" = t.id
FROM "Tenant" t
WHERE t."originUserId" = i."userId";

-- 7. Actualizar tenantId en Product
UPDATE "Product" p
SET "tenantId" = t.id
FROM "Tenant" t
WHERE t."originUserId" = p."userId";

-- 8. Actualizar tenantId en Promotion
UPDATE "Promotion" pr
SET "tenantId" = t.id
FROM "Tenant" t
WHERE t."originUserId" = pr."userId";

-- 9. Actualizar tenantId en ShippingLocation
UPDATE "ShippingLocation" sl
SET "tenantId" = t.id
FROM "Tenant" t
WHERE t."originUserId" = sl."userId";

-- 10. Actualizar tenantId en ContactLabel
UPDATE "ContactLabel" cl
SET "tenantId" = t.id
FROM "Tenant" t
WHERE t."originUserId" = cl."userId";

-- 11. Actualizar tenantId en Template
UPDATE "Template" tmpl
SET "tenantId" = t.id
FROM "Tenant" t
WHERE t."originUserId" = tmpl."userId";
