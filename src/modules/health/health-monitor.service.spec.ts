import { Test, TestingModule } from '@nestjs/testing';
import { HealthMonitorService } from './health-monitor.service';
import { ApiHealthRepository } from './repositories/api-health.repository';
import { HealthService } from './health.service';
import { AppWebSocketGateway } from '@common/websocket/websocket.gateway';
import { ApiName, HealthStatus } from '@prisma/client';

describe('HealthMonitorService - checkAPIs', () => {
  let service: HealthMonitorService;
  let apiHealthRepository: jest.Mocked<ApiHealthRepository>;
  let healthService: jest.Mocked<HealthService>;
  let websocketGateway: jest.Mocked<AppWebSocketGateway>;

  beforeEach(async () => {
    // Crear mocks
    const mockApiHealthRepository = {
      getAPIsToMonitor: jest.fn(),
      markAsUp: jest.fn(),
      markAsDown: jest.fn(),
    };

    const mockHealthService = {
      pingAPI: jest.fn(),
      notifyAffectedClients: jest.fn(),
    };

    const mockWebSocketGateway = {
      emitApiUp: jest.fn(),
      emitApiDown: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthMonitorService,
        {
          provide: ApiHealthRepository,
          useValue: mockApiHealthRepository,
        },
        {
          provide: HealthService,
          useValue: mockHealthService,
        },
        {
          provide: AppWebSocketGateway,
          useValue: mockWebSocketGateway,
        },
      ],
    }).compile();

    service = module.get<HealthMonitorService>(HealthMonitorService);
    apiHealthRepository = module.get(ApiHealthRepository);
    healthService = module.get(HealthService);
    websocketGateway = module.get(AppWebSocketGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkAPIs - API Recovery', () => {
    it('should detect API recovery and mark as UP', async () => {
      // ARRANGE: Simular API DOWN siendo monitoreada
      const mockApiDown = {
        id: 'test-id',
        apiName: 'qwen_stt' as ApiName,
        status: 'down' as HealthStatus,
        monitoringActive: true,
        responseTimeMs: null,
        errorMessage: 'Connection timeout',
        lastErrorAt: new Date(),
        lastCheckAt: new Date(),
        recoveredAt: null,
      };

      apiHealthRepository.getAPIsToMonitor.mockResolvedValue([mockApiDown]);

      // Mock: pingAPI retorna que la API está UP
      healthService.pingAPI.mockResolvedValue({
        isUp: true,
        responseTimeMs: 250,
      });

      // Mock: markAsUp retorna API actualizada
      apiHealthRepository.markAsUp.mockResolvedValue({
        ...mockApiDown,
        status: 'up' as HealthStatus,
        monitoringActive: false,
        responseTimeMs: 250,
        errorMessage: null,
        recoveredAt: new Date(),
      });

      // ACT: Ejecutar checkAPIs
      await service.checkAPIs();

      // ASSERT: Verificar que se ejecutaron las acciones correctas
      expect(apiHealthRepository.getAPIsToMonitor).toHaveBeenCalledTimes(1);
      expect(healthService.pingAPI).toHaveBeenCalledWith('qwen_stt');
      expect(apiHealthRepository.markAsUp).toHaveBeenCalledWith(
        'qwen_stt',
        250,
      );
      expect(healthService.notifyAffectedClients).toHaveBeenCalledWith(
        'qwen_stt',
      );
      expect(websocketGateway.emitApiUp).toHaveBeenCalledWith('qwen_stt');
    });

    it('should NOT execute if no APIs are being monitored (zero overhead)', async () => {
      // ARRANGE: No hay APIs siendo monitoreadas
      apiHealthRepository.getAPIsToMonitor.mockResolvedValue([]);

      // ACT
      await service.checkAPIs();

      // ASSERT: No se ejecuta ping ni otras acciones
      expect(apiHealthRepository.getAPIsToMonitor).toHaveBeenCalledTimes(1);
      expect(healthService.pingAPI).not.toHaveBeenCalled();
      expect(apiHealthRepository.markAsUp).not.toHaveBeenCalled();
    });

    it('should continue monitoring if API is still DOWN', async () => {
      // ARRANGE: API DOWN siendo monitoreada
      const mockApiDown = {
        id: 'test-id',
        apiName: 'kimi_llm' as ApiName,
        status: 'down' as HealthStatus,
        monitoringActive: true,
        responseTimeMs: null,
        errorMessage: 'HTTP 500',
        lastErrorAt: new Date(),
        lastCheckAt: new Date(),
        recoveredAt: null,
      };

      apiHealthRepository.getAPIsToMonitor.mockResolvedValue([mockApiDown]);

      // Mock: pingAPI retorna que la API sigue DOWN
      healthService.pingAPI.mockResolvedValue({
        isUp: false,
        responseTimeMs: 5000,
        error: 'HTTP 500',
      });

      // ACT
      await service.checkAPIs();

      // ASSERT: NO se marca como UP ni se notifica
      expect(healthService.pingAPI).toHaveBeenCalledWith('kimi_llm');
      expect(apiHealthRepository.markAsUp).not.toHaveBeenCalled();
      expect(healthService.notifyAffectedClients).not.toHaveBeenCalled();
      expect(websocketGateway.emitApiUp).not.toHaveBeenCalled();
    });
  });
});
