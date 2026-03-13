import { Injectable } from '@nestjs/common';
import { UserSettingsRepository } from '@modules/user-settings/repositories/user-settings.repository';

@Injectable()
export class WorkScheduleService {
  constructor(private readonly userSettingsRepo: UserSettingsRepository) {}

  async isWithinWorkHours(userId: string): Promise<boolean> {
    const settings = await this.userSettingsRepo.findByUserId(userId);
    if (!settings) return true; // no settings = always available

    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay(); // 0=Sun, 1=Mon...6=Sat

    const workDays = settings.workDays.split(',').map(Number);
    if (!workDays.includes(currentDay)) return false;

    return currentHour >= settings.workStartHour && currentHour < settings.workEndHour;
  }

  async getDelayUntilNextWorkHour(userId: string): Promise<number> {
    const settings = await this.userSettingsRepo.findByUserId(userId);
    if (!settings) return 0;

    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const workDays = settings.workDays.split(',').map(Number);

    // Try today first if current hour < startHour and today is a work day
    if (workDays.includes(currentDay) && currentHour < settings.workStartHour) {
      const target = new Date(now);
      target.setHours(settings.workStartHour, 0, 0, 0);
      return target.getTime() - now.getTime();
    }

    // Find next work day
    for (let offset = 1; offset <= 7; offset++) {
      const nextDay = (currentDay + offset) % 7;
      if (workDays.includes(nextDay)) {
        const target = new Date(now);
        target.setDate(target.getDate() + offset);
        target.setHours(settings.workStartHour, 0, 0, 0);
        return target.getTime() - now.getTime();
      }
    }

    return 0; // fallback: no delay
  }
}
