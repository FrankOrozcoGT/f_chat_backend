import {
  Controller,
  Get,
  Query,
  UseGuards,
  Patch,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { CostsRepository } from './repositories/costs.repository';
import { ApiHealthRepository } from '@modules/health/repositories/api-health.repository';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { CostsQueryDto } from './dto/costs-query.dto';
import { CostsResponseDto } from './dto/costs-response.dto';
import { UpdateUserLimitsDto } from './dto/update-user-limits.dto';
import { UpdateUserPlanDto } from './dto/update-user-plan.dto';
import { UserLimitsResponseDto } from './dto/user-limits-response.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly costsRepository: CostsRepository,
    private readonly apiHealthRepository: ApiHealthRepository,
    private readonly userRepository: UserRepository,
  ) {}

  @Get('costs')
  async getCosts(@Query() query: CostsQueryDto): Promise<CostsResponseDto> {
    // 1. Obtener datos de DB vía Repository (TODOS los usuarios)
    const apiCalls = await this.costsRepository.getApiCallsByPeriod(
      query.period,
    );

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

  @Patch('users/:userId/plan')
  async updateUserPlan(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserPlanDto,
  ) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const updated = await this.userRepository.updatePlan(userId, dto.plan);
    return { id: updated.id, email: updated.email, plan: updated.plan };
  }

  @Patch('users/:userId/limits')
  async updateUserLimits(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserLimitsDto,
  ): Promise<UserLimitsResponseDto> {
    // 1. Verificar que el usuario existe
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2. Actualizar límites vía Repository
    const updatedUser = await this.userRepository.updateLimits(userId, dto);

    // 3. Retornar response con datos actualizados
    return {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      whatsappLimit: updatedUser.whatsappLimit,
      creditsLimit: updatedUser.creditsLimit,
      creditsUsed: updatedUser.creditsUsed,
      billingPeriodStart: updatedUser.billingPeriodStart,
    };
  }
}
