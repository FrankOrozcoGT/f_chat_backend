import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

@Injectable()
export class CostsRepository {
  constructor(private prisma: PrismaService) {}

  async getApiCallsByPeriod(period: 'day' | 'week' | 'month') {
    const now = new Date();
    const startDate = new Date();

    switch (period) {
      case 'day':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
    }

    return this.prisma.apiCall.findMany({
      where: {
        calledAt: {
          gte: startDate,
        },
      },
      include: {
        message: {
          include: {
            conversation: {
              include: {
                phone: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        calledAt: 'desc',
      },
    });
  }
}
