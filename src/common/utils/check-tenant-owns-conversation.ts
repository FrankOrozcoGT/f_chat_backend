import { ForbiddenException } from '@nestjs/common';
import { Phone } from '@prisma/client';

/**
 * Valida que el tenant sea dueño de la conversación (vía phone)
 * @throws ForbiddenException si el tenant no es dueño
 */
export function checkTenantOwnsConversation(
  conversation: { id: string; phoneId: string },
  phone: Phone,
  tenantId: string,
): void {
  if (phone.tenantId !== tenantId) {
    throw new ForbiddenException(
      'You do not have permission to access this conversation',
    );
  }
}
