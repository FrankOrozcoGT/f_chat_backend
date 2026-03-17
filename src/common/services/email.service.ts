import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly from: string;
  private readonly logger = new Logger(EmailService.name);

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
    this.from = process.env.RESEND_FROM_EMAIL ?? 'noreply@chat.fcoder.uk';
  }

  async sendTenantInvitation(params: {
    to: string;
    tenantName: string;
    inviterName: string;
    role: string;
    acceptUrl: string;
  }): Promise<void> {
    const { to, tenantName, inviterName, role, acceptUrl } = params;

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: `Invitación para unirte a ${tenantName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Fuiste invitado a <strong>${tenantName}</strong></h2>
          <p><strong>${inviterName}</strong> te invitó a unirte como <strong>${role}</strong>.</p>
          <p>
            <a href="${acceptUrl}" style="
              display: inline-block;
              padding: 12px 24px;
              background: #2563eb;
              color: white;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
            ">Aceptar invitación</a>
          </p>
          <p style="color: #6b7280; font-size: 14px;">
            Este enlace expira en 7 días. Si no esperabas esta invitación, puedes ignorar este email.
          </p>
        </div>
      `,
    });

    if (error) {
      this.logger.error(`Failed to send invitation email to ${to}`, error);
      throw new Error(`Email send failed: ${error.message}`);
    }
  }
}
