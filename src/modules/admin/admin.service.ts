import { Injectable, NotFoundException } from '@nestjs/common';
import { ApiName } from '@prisma/client';
import { CostsRepository } from './repositories/costs.repository';
import { ApiHealthRepository } from '@modules/health/repositories/api-health.repository';
import { TenantSettingsRepository } from '@modules/tenant-settings/repositories/tenant-settings.repository';
import { TenantRepository } from '@modules/tenants/repositories/tenant.repository';
import { CostsQueryDto } from './dto/costs-query.dto';
import { UpdateUserLimitsDto } from './dto/update-user-limits.dto';
import { UpdateUserPlanDto } from './dto/update-user-plan.dto';

interface ApiCallWithRelations {
  id: string;
  apiType: string;
  costUsd: number;
  calledAt: Date;
  message: {
    conversation: {
      id: string;
      phone: {
        tenant: {
          id: string;
          name: string;
        };
      };
    };
  };
}

export interface ApiHealthRecord {
  id: string;
  apiName: ApiName;
  status: string;
  monitoringActive: boolean;
  responseTimeMs: number | null;
  errorMessage: string | null;
  lastErrorAt: Date | null;
  lastCheckAt: Date | null;
  recoveredAt: Date | null;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly costsRepository: CostsRepository,
    private readonly apiHealthRepository: ApiHealthRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly tenantRepository: TenantRepository,
  ) {}

  async getCosts(query: CostsQueryDto) {
    const apiCalls = await this.costsRepository.getApiCallsByPeriod(query.period);
    return this.aggregateCosts(apiCalls);
  }

  getAllTenants() {
    return this.tenantRepository.findAllWithSettings();
  }

  async getHealth() {
    const dbRecords = await this.apiHealthRepository.getAllApiHealth();
    return this.getHealthStatus(dbRecords);
  }

  async updateTenantPlan(tenantId: string, dto: UpdateUserPlanDto) {
    await this.assertTenantSettingsExist(tenantId);
    return this.tenantSettingsRepository.updatePlan(tenantId, dto.plan);
  }

  async updateTenantLimits(tenantId: string, dto: UpdateUserLimitsDto) {
    await this.assertTenantSettingsExist(tenantId);
    return this.tenantSettingsRepository.updateLimits(tenantId, dto);
  }

  private async assertTenantSettingsExist(tenantId: string): Promise<void> {
    const settings = await this.tenantSettingsRepository.findByTenantId(tenantId);
    if (!settings) {
      throw new NotFoundException('Tenant settings not found');
    }
  }

  aggregateCosts(apiCalls: ApiCallWithRelations[]) {
    // Inicializar totales por tipo de API
    let totalSTT = 0;
    let totalLLM = 0;
    let totalTTS = 0;

    // Maps para agregaciones
    const byTenantMap = new Map<
      string,
      {
        tenantId: string;
        tenantName: string;
        total: number;
        conversationIds: Set<string>;
      }
    >();
    const byDayMap = new Map<string, number>();

    // Procesar cada API call
    for (const apiCall of apiCalls) {
      const cost = apiCall.costUsd;

      // Agregar por tipo de API
      if (apiCall.apiType === 'qwen_stt') {
        totalSTT += cost;
      } else if (apiCall.apiType === 'kimi_llm') {
        totalLLM += cost;
      } else if (apiCall.apiType === 'qwen_tts') {
        totalTTS += cost;
      }

      // Agregar por TENANT
      const tenant = apiCall.message.conversation.phone.tenant;
      const tenantKey = tenant.id;
      const conversationId = apiCall.message.conversation.id;

      if (byTenantMap.has(tenantKey)) {
        const tenantData = byTenantMap.get(tenantKey)!;
        tenantData.total += cost;
        tenantData.conversationIds.add(conversationId);
      } else {
        byTenantMap.set(tenantKey, {
          tenantId: tenant.id,
          tenantName: tenant.name,
          total: cost,
          conversationIds: new Set([conversationId]),
        });
      }

      // Agregar por día
      const dateKey = apiCall.calledAt.toISOString().split('T')[0]; // YYYY-MM-DD
      if (byDayMap.has(dateKey)) {
        byDayMap.set(dateKey, byDayMap.get(dateKey)! + cost);
      } else {
        byDayMap.set(dateKey, cost);
      }
    }

    // Convertir maps a arrays, calcular promedios, y ordenar
    const byTenant = Array.from(byTenantMap.values())
      .map((tenantData) => {
        const totalConversations = tenantData.conversationIds.size;
        const avgCostPerConversation =
          totalConversations > 0 ? tenantData.total / totalConversations : 0;

        return {
          tenantId: tenantData.tenantId,
          tenantName: tenantData.tenantName,
          total: parseFloat(tenantData.total.toFixed(6)),
          totalConversations,
          avgCostPerConversation: parseFloat(avgCostPerConversation.toFixed(6)),
        };
      })
      .sort((a, b) => b.total - a.total);

    const byDay = Array.from(byDayMap.entries())
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calcular total general
    const total = totalSTT + totalLLM + totalTTS;

    return {
      totalSTT: parseFloat(totalSTT.toFixed(6)),
      totalLLM: parseFloat(totalLLM.toFixed(6)),
      totalTTS: parseFloat(totalTTS.toFixed(6)),
      total: parseFloat(total.toFixed(6)),
      byTenant,
      byDay,
    };
  }

  getHealthStatus(dbRecords: ApiHealthRecord[]) {
    // Todas las APIs del sistema
    const allApis: ApiName[] = ['qwen_stt', 'kimi_llm', 'qwen_tts'];

    // Crear mapa de registros existentes para búsqueda rápida
    const dbMap = new Map<ApiName, ApiHealthRecord>();
    for (const record of dbRecords) {
      dbMap.set(record.apiName, record);
    }

    // Generar response para cada API
    return allApis.map((apiName) => {
      const dbRecord = dbMap.get(apiName);

      if (dbRecord) {
        // API tiene registro en DB → usar su estado real
        return dbRecord;
      } else {
        // API NO tiene registro → estado por defecto (nunca ha fallado)
        return {
          id: `default-${apiName}`,
          apiName,
          status: 'up',
          monitoringActive: false,
          responseTimeMs: null,
          errorMessage: null,
          lastErrorAt: null,
          lastCheckAt: null,
          recoveredAt: null,
        };
      }
    });
  }
}
