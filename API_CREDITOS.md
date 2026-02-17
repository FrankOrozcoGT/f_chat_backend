# API - Sistema de Créditos

## Implementación
Sistema de créditos con deuda acumulable:
- **NO bloquea** cuando se excede el límite
- Permite que el flujo completo se ejecute (STT → LLM → TTS)
- Los créditos pueden quedar en **negativo**
- La deuda se **arrastra al siguiente mes** (reset mensual mantiene la deuda)

## Endpoints afectados

### POST /api/messages/send
- Valida créditos antes de procesar
- Retorna 403 si excede límite
- Incrementa creditsUsed

### POST /api/messages/send-with-file
- Valida créditos para audio (STT)
- Valida créditos para respuesta (LLM + TTS)

### GET /api/auth/me
Retorna info del usuario autenticado:
```json
{
  "creditsUsed": 120.5,
  "creditsLimit": 5000,
  "billingPeriodStart": "2026-01-17T..."
}
```

### GET /api/users (solo admin)
Lista todos los usuarios con sus créditos

### PATCH /admin/users/:userId/limits (admin)
Actualiza límites:
```json
{
  "creditsLimit": 10000,
  "whatsappLimit": 5
}
```

## Comportamiento con créditos excedidos
- **NO se lanza error 403** cuando se excede el límite
- El mensaje se procesa completamente
- `creditsUsed` puede ser mayor a `creditsLimit` (ejemplo: 5250 / 5000)
- La deuda (250 en el ejemplo) se mantiene al resetear el mes siguiente

## Frontend - TypeScript

### Mostrar progreso
```typescript
const percentage = (user.creditsUsed / user.creditsLimit) * 100;
const excedido = user.creditsUsed > user.creditsLimit;

// Ejemplo: 5250 / 5000 = 105% (excedido en 250 créditos)
if (excedido) {
  const deuda = user.creditsUsed - user.creditsLimit;
  console.log(`⚠️ Excedido en ${deuda} créditos (se descontará el próximo mes)`);
}
```

### Indicador visual
```typescript
// Barra de progreso con color según estado
const color = percentage > 100 ? 'red' : percentage > 80 ? 'orange' : 'green';
```
