import { Resend } from "resend";
import nodemailer from "nodemailer";
import { prisma } from "./prisma";

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export async function getEmailConfig() {
  return prisma.cRM_EmailConfig.findFirst({
    where: { flaAtivo: true },
    orderBy: { id: "desc" },
  });
}

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  const config = await getEmailConfig();
  if (!config) {
    console.error("[email] Nenhuma configuração de e-mail ativa (CRM_EmailConfig).");
    return;
  }

  const fromName = config.FromName || "CRM Eltech";
  const fromEmail = config.FromEmail;
  if (!fromEmail) {
    console.error("[email] FromEmail não configurado.");
    return;
  }
  const from = `${fromName} <${fromEmail}>`;

  try {
    if (config.Provider === "resend") {
      if (!config.ResendApiKey) throw new Error("ResendApiKey não configurada");
      const resend = new Resend(config.ResendApiKey);
      const { error } = await resend.emails.send({ from, to, subject, html });
      if (error) throw error;
      return;
    }

    if (config.Provider === "smtp") {
      if (!config.SmtpHost || !config.SmtpUser || !config.SmtpPassword) {
        throw new Error("Configuração SMTP incompleta");
      }
      const transporter = nodemailer.createTransport({
        host: config.SmtpHost,
        port: config.SmtpPort || 587,
        secure: !!config.SmtpSecure,
        auth: { user: config.SmtpUser, pass: config.SmtpPassword },
      });
      await transporter.sendMail({ from, to, subject, html });
      return;
    }

    console.error(`[email] Provider desconhecido: ${config.Provider}`);
  } catch (e) {
    console.error("[email] Falha ao enviar e-mail:", e);
  }
}
