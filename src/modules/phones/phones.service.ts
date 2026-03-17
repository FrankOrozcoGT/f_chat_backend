import { BadRequestException, Injectable } from '@nestjs/common';
import { PhoneStatus } from '@prisma/client';
import { CreatePhoneDto } from './dto/create-phone.dto';
import { CreateInstanceResponseDto } from '@common/evolution/dto/evolution-response.dto';

@Injectable()
export class PhonesService {
  validateInstanceName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new BadRequestException('Instance name cannot be empty');
    }

    if (name.length > 50) {
      throw new BadRequestException(
        'Instance name cannot exceed 50 characters',
      );
    }
  }

  buildPhoneData(
    dto: CreatePhoneDto,
    evolutionData: CreateInstanceResponseDto,
    tenantId: string,
  ) {
    return {
      tenantId,
      instanceName: dto.instanceName,
      // Use instanceName for webhook matching (Evolution sends instanceName in webhooks)
      evolutionInstanceId:
        evolutionData.instance.instanceName || dto.instanceName,
      status: PhoneStatus.pending,
      phoneNumber: '',
      qrCode: evolutionData.qrcode?.code,
    };
  }
}
