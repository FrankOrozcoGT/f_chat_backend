import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { UserSettingsRepository } from '@modules/user-settings/repositories/user-settings.repository';
import { UserQueueManager } from './user-queue-manager.service';

export interface DaySchedule {
  start: number;
  end: number;
}

export type WorkSchedule = Record<string, DaySchedule>;

@Injectable()
export class QueueSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(QueueSchedulerService.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly userSettingsRepo: UserSettingsRepository,
    private readonly userQueueManager: UserQueueManager,
  ) {}

  async onModuleInit() {
    const allSettings = await this.userSettingsRepo.findAll();
    for (const settings of allSettings) {
      const schedule = settings.workSchedule as unknown as WorkSchedule;
      this.registerCronsForUser(settings.userId, schedule);
    }
    this.logger.log(`Registered crons for ${allSettings.length} users`);
  }

  /**
   * Registers pause/resume cron jobs for a user based on their workSchedule.
   * Call this on init and whenever the user updates their settings.
   */
  registerCronsForUser(userId: string, schedule: WorkSchedule) {
    this.clearCronsForUser(userId);

    // Group days by same start/end hours to minimize cron jobs
    const resumeGroups = new Map<number, number[]>(); // startHour → [days]
    const pauseGroups = new Map<number, number[]>();   // endHour → [days]

    for (const [day, hours] of Object.entries(schedule)) {
      const dayNum = parseInt(day, 10);

      const resumeDays = resumeGroups.get(hours.start) ?? [];
      resumeDays.push(dayNum);
      resumeGroups.set(hours.start, resumeDays);

      const pauseDays = pauseGroups.get(hours.end) ?? [];
      pauseDays.push(dayNum);
      pauseGroups.set(hours.end, pauseDays);
    }

    // Create resume crons
    let cronIndex = 0;
    for (const [hour, days] of resumeGroups) {
      const cronName = `queue-resume-${userId}-${cronIndex}`;
      const cronExpr = `0 ${hour} * * ${days.join(',')}`;
      const job = new CronJob(cronExpr, async () => {
        await this.userQueueManager.resumeUser(userId);
        this.logger.log(`[cron] Resumed queue for user ${userId}`);
      });
      this.schedulerRegistry.addCronJob(cronName, job);
      job.start();
      cronIndex++;
    }

    // Create pause crons
    for (const [hour, days] of pauseGroups) {
      const cronName = `queue-pause-${userId}-${cronIndex}`;
      const cronExpr = `0 ${hour} * * ${days.join(',')}`;
      const job = new CronJob(cronExpr, async () => {
        await this.userQueueManager.pauseUser(userId);
        this.logger.log(`[cron] Paused queue for user ${userId}`);
      });
      this.schedulerRegistry.addCronJob(cronName, job);
      job.start();
      cronIndex++;
    }

    // Set initial state: if we're currently outside work hours, pause now
    const now = new Date();
    const currentDay = now.getDay().toString();
    const currentHour = now.getHours();
    const todaySchedule = schedule[currentDay];

    if (!todaySchedule || currentHour < todaySchedule.start || currentHour >= todaySchedule.end) {
      this.userQueueManager.pauseUser(userId).catch((err) =>
        this.logger.warn(`Failed initial pause for user ${userId}: ${err.message}`),
      );
    }

    this.logger.log(`Registered ${cronIndex} crons for user ${userId}`);
  }

  clearCronsForUser(userId: string) {
    const allCrons = this.schedulerRegistry.getCronJobs();
    for (const [name] of allCrons) {
      if (name.startsWith(`queue-resume-${userId}-`) || name.startsWith(`queue-pause-${userId}-`)) {
        this.schedulerRegistry.deleteCronJob(name);
      }
    }
  }
}
