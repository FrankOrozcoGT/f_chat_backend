import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { CostsRepository } from './repositories/costs.repository';
import { ApiHealthRepository } from '@modules/health/repositories/api-health.repository';
import { CostsQueryDto } from './dto/costs-query.dto';
import { CostsResponseDto } from './dto/costs-response.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly costsRepository: CostsRepository,
    private readonly apiHealthRepository: ApiHealthRepository,
  ) {}

  @Get('costs')
  async getCosts(@Query() query: CostsQueryDto): Promise<CostsResponseDto> {
    // 1. Obtener datos de DB vía Repository (TODOS los usuarios)
    const apiCalls = await this.costsRepository.getApiCallsByPeriod(query.period);

    // 2. Transformar datos con Service (lógica pura, agrupa por USER)
    const aggregatedCosts = this.adminService.aggregateCosts(apiCalls);

    // 3. Retornar response
    return aggregatedCosts;
  }

  @Get('health')
  async getHealthStatus() {
    // 1. Obtener registros de DB vía Repository
    const dbRecords = await this.apiHealthRepository.getAllApiHealth();

    // 2. Transformar con Service (asegura que las 3 APIs estén en response)
    const healthStatus = this.adminService.getHealthStatus(dbRecords);

    // 3. Retornar response
    return healthStatus;
  }
}
