import { Injectable } from '@nestjs/common';
import { ApiName } from '@prisma/client';

interface ApiCallWithRelations {
  id: string;
  apiType: string;
  costUsd: number;
  calledAt: Date;
  message: {
    conversation: {
      id: string;
      phone: {
        user: {
          id: string;
          name: string;
          email: string;
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
  aggregateCosts(apiCalls: ApiCallWithRelations[]) {
    // Inicializar totales por tipo de API
    let totalSTT = 0;
    let totalLLM = 0;
    let totalTTS = 0;

    // Maps para agregaciones
    const byUserMap = new Map<
      string,
      {
        userId: string;
        userName: string;
        email: string;
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
      } else if (apiCall.apiType === 'kimi_llm' || apiCall.apiType === 'kimi_flow_analyzer') {
        totalLLM += cost;
      } else if (apiCall.apiType === 'qwen_tts') {
        totalTTS += cost;
      }

      // Agregar por USUARIO
      const user = apiCall.message.conversation.phone.user;
      const userKey = user.id;
      const conversationId = apiCall.message.conversation.id;

      if (byUserMap.has(userKey)) {
        const userData = byUserMap.get(userKey)!;
        userData.total += cost;
        userData.conversationIds.add(conversationId);
      } else {
        byUserMap.set(userKey, {
          userId: user.id,
          userName: user.name,
          email: user.email,
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
    const byUser = Array.from(byUserMap.values())
      .map((userData) => {
        const totalConversations = userData.conversationIds.size;
        const avgCostPerConversation =
          totalConversations > 0 ? userData.total / totalConversations : 0;

        return {
          userId: userData.userId,
          userName: userData.userName,
          email: userData.email,
          total: parseFloat(userData.total.toFixed(6)),
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
      byUser,
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
