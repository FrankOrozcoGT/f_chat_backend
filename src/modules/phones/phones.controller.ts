import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
  Req,
  Logger,
  BadGatewayException,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { EvolutionService } from '@common/evolution/evolution.service';
import { LimitsService } from '@common/services/limits.service';
import { PhoneRepository } from './repositories/phone.repository';
import { PhonesService } from './phones.service';
import { PhoneResponseDto } from './dto/phone-response.dto';
import { CreatePhoneDto } from './dto/create-phone.dto';

@Controller('api/phones')
@UseInterceptors(ClassSerializerInterceptor)
export class PhonesController {
  private readonly logger = new Logger(PhonesController.name);

  constructor(
    private readonly phoneRepository: PhoneRepository,
    private readonly phonesService: PhonesService,
    private readonly evolutionService: EvolutionService,
    private readonly limitsService: LimitsService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@Req() req): Promise<PhoneResponseDto[]> {
    const userId = req.user.id;
    const phones = await this.phoneRepository.findAllByUserId(userId);
    return phones.map((phone) => new PhoneResponseDto(phone));
  }

  @Post('create')
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreatePhoneDto, @Req() req) {
    const userId = req.user.id;

    // 1. Validar instanceName
    this.phonesService.validateInstanceName(dto.instanceName);

    // 2. Validar límite de WhatsApp
    await this.limitsService.validateWhatsAppLimit(userId);

    // 3. Crear instancia en Evolution API con QR (webhook se configura global en docker-compose)
    let evolutionData;
    try {
      evolutionData = await this.evolutionService.createInstance(
        dto.instanceName,
        { qrcode: true },
      );
    } catch (error) {
      this.logger.error(`Failed to create instance in Evolution API: ${error.message}`);
      throw new BadGatewayException('Failed to create WhatsApp instance');
    }

    // 4. Construir datos del phone con QR
    const phoneData = this.phonesService.buildPhoneData(dto, evolutionData, userId);

    // 5. Guardar en DB
    const phone = await this.phoneRepository.create(phoneData);

    this.logger.log(`Phone instance created successfully: ${phone.id}`);

    // 6. Retornar phone + qrCode
    return {
      phone: new PhoneResponseDto(phone),
      qrCode: evolutionData.qrcode?.code || null,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(@Param('id') phoneId: string, @Req() req) {
    const userId = req.user.id;

    // 1. Buscar phone y verificar ownership
    const phone = await this.phoneRepository.findById(phoneId);
    if (!phone) {
      throw new NotFoundException('Phone not found');
    }

    if (phone.userId !== userId) {
      throw new NotFoundException('Phone not found');
    }

    // 2. Eliminar instancia en Evolution API
    try {
      await this.evolutionService.deleteInstance(phone.instanceName);
    } catch (error) {
      this.logger.warn(`Failed to delete instance in Evolution API: ${error.message}`);
      // Continuar con eliminación en DB aunque falle en Evolution
    }

    // 3. Eliminar de DB
    await this.phoneRepository.delete(phoneId);

    this.logger.log(`Phone deleted successfully: ${phoneId}`);

    return { message: 'Phone deleted successfully' };
  }
}
