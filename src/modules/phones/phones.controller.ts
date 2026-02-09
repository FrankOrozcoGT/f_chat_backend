import {
  Controller,
  Get,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { PhoneRepository } from './repositories/phone.repository';
import { PhoneResponseDto } from './dto/phone-response.dto';

@Controller('api/phones')
@UseInterceptors(ClassSerializerInterceptor)
export class PhonesController {
  constructor(private readonly phoneRepository: PhoneRepository) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@Req() req): Promise<PhoneResponseDto[]> {
    const userId = req.user.id;
    const phones = await this.phoneRepository.findAllByUserId(userId);
    return phones.map((phone) => new PhoneResponseDto(phone));
  }
}
