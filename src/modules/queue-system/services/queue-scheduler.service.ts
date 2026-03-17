import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TenantSettingsRepository } from '@modules/tenant-settings/repositories/tenant-settings.repository';
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
    private readonly tenantSettingsRepo: TenantSettingsRepository,
    private readonly userQueueManager: UserQueueManager,
  ) {}

  async onModuleInit() {
    const allSettings = await this.tenantSettingsRepo.findAll();
    for (const settings of allSettings) {
      const schedule = settings.workSchedule as unknown as WorkSchedule;
      this.registerCronsForUser(settings.tenantId, schedule);
    }
    this.logger.log(`Registered crons for ${allSettings.length} tenants`);
  }

  /**
   * Registers pause/resume cron jobs for a tenant based on their workSchedule.
   * Call this on init and whenever the tenant updates their settings.
   */
  registerCronsForUser(tenantId: string, schedule: WorkSchedule) {
    this.clearCronsForUser(tenantId);

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
      const cronName = `queue-resume-${tenantId}-${cronIndex}`;
      const cronExpr = `0 ${hour} * * ${days.join(',')}`;
      const job = new CronJob(cronExpr, async () => {
        await this.userQueueManager.resumeUser(tenantId);
        this.logger.log(`[cron] Resumed queue for tenant ${tenantId}`);
      });
      this.schedulerRegistry.addCronJob(cronName, job);
      job.start();
      cronIndex++;
    }

    // Create pause crons
    for (const [hour, days] of pauseGroups) {
      const cronName = `queue-pause-${tenantId}-${cronIndex}`;
      const cronExpr = `0 ${hour} * * ${days.join(',')}`;
      const job = new CronJob(cronExpr, async () => {
        await this.userQueueManager.pauseUser(tenantId);
        this.logger.log(`[cron] Paused queue for tenant ${tenantId}`);
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
      this.userQueueManager.pauseUser(tenantId).catch((err) =>
        this.logger.warn(`Failed initial pause for tenant ${tenantId}: ${err.message}`),
      );
    }

    this.logger.log(`Registered ${cronIndex} crons for tenant ${tenantId}`);
  }

  clearCronsForUser(tenantId: string) {
    const allCrons = this.schedulerRegistry.getCronJobs();
    for (const [name] of allCrons) {
      if (name.startsWith(`queue-resume-${tenantId}-`) || name.startsWith(`queue-pause-${tenantId}-`)) {
        this.schedulerRegistry.deleteCronJob(name);
      }
    }
  }
}
