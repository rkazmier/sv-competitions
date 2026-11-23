/**
 * Klient SMTP dla `mail-send` (ADR-0009): TLS od początku połączenia (port 465 — Edge Functions blokują 25 i 587),
 * jedno połączenie na wywołanie funkcji. Testy używają podstawionego klienta (handler_test.ts).
 */
import nodemailer from 'npm:nodemailer@6.9.16';
import type { Mail, Mailer, SmtpConfig } from './handler.ts';

export function createSmtpMailer(smtp: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: true,
    auth: { user: smtp.user, pass: smtp.password },
    pool: true,
    maxConnections: 1,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    // Bez logów transportu — zawierałyby adresy odbiorców.
    logger: false,
    debug: false,
  });
  return {
    async send(mail: Mail) {
      await transport.sendMail({
        from: { name: mail.from.name, address: mail.from.address },
        replyTo: mail.replyTo,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
    },
    close() {
      transport.close();
    },
  };
}
