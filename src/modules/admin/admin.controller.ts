import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { CostsRepository } from './repositories/costs.repository';
import { CostsQueryDto } from './dto/costs-query.dto';
import { CostsResponseDto } from './dto/costs-response.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly costsRepository: CostsRepository,
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
}
