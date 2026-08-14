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

interface PropostaStatusEmailInput {
  propostaNo: string | number;
  vendedorNome: string;
  clienteNome: string;
  idProposta: number;
}

interface StatusEmailTheme {
  preheader: string;
  gradientFrom: string;
  gradientTo: string;
  badgeDotColor: string;
  badgeTextColor: string;
  badgeLabel: string;
  iconSvg: string;
  title: string;
  subtitle: string;
  subtitleColor: string;
  bodyHtml: (primeiroNome: string, vendedorNome: string) => string;
  footerNote: string;
}

function buildStatusEmail(
  { propostaNo, vendedorNome, clienteNome, idProposta }: PropostaStatusEmailInput,
  theme: StatusEmailTheme
): string {
  const frontendUrl = process.env.FRONTEND_URL || "https://app.eltechquimica.com.br";
  const link = frontendUrl ? `${frontendUrl.replace(/\/$/, "")}/proposta-comercial/${idProposta}` : null;
  const primeiroNome = (vendedorNome || "").trim().split(" ")[0] || "";
  const ano = new Date().getFullYear();

  return `
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <!--[if mso]>
    <noscript>
      <xml>
        <o:OfficeDocumentSettings>
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
      </xml>
    </noscript>
    <![endif]-->
  </head>
  <body style="margin:0;padding:0;background-color:#0b0f14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      ${theme.preheader}
      &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0f14;padding:40px 16px;">
      <tr>
        <td align="center">

          <!-- Wordmark -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin-bottom:24px;">
            <tr>
              <td align="center">
                ${
                  frontendUrl
                    ? `<img src="${frontendUrl.replace(/\/$/, "")}/logo_eltech.png" alt="Eltech" height="28" style="height:28px;width:auto;display:inline-block;" />`
                    : `<span style="color:#5b6472;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">ELTECH &nbsp;&middot;&nbsp; CRM</span>`
                }
              </td>
            </tr>
          </table>

          <!-- Card -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 24px 48px -12px rgba(0,0,0,0.45);">

            <!-- Hero -->
            <tr>
              <td style="background-color:${theme.gradientFrom};background-image:linear-gradient(135deg,${theme.gradientFrom} 0%,${theme.gradientTo} 100%);padding:40px 32px 88px;position:relative;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <table role="presentation" cellpadding="0" cellspacing="0" style="background-color:rgba(255,255,255,0.14);border-radius:999px;">
                        <tr>
                          <td style="padding:6px 14px 6px 10px;">
                            <table role="presentation" cellpadding="0" cellspacing="0">
                              <tr>
                                <td style="padding-right:8px;vertical-align:middle;">${theme.iconSvg}</td>
                                <td style="color:${theme.badgeTextColor};font-size:12px;font-weight:700;letter-spacing:.04em;vertical-align:middle;">${theme.badgeLabel}</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding-top:20px;">
                      <span style="display:block;color:#ffffff;font-size:26px;line-height:1.3;font-weight:800;">
                        ${theme.title}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding-top:8px;">
                      <span style="display:block;color:${theme.subtitleColor};font-size:14.5px;line-height:1.6;max-width:420px;">
                        ${theme.subtitle}
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Floating info card (overlaps hero) -->
            <tr>
              <td style="padding:0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid #eef0f2;border-radius:14px;box-shadow:0 12px 24px -8px rgba(16,24,40,0.12);margin-top:-56px;position:relative;">
                  <tr>
                    <td style="padding:22px 24px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td width="50%" style="vertical-align:top;padding-right:12px;border-right:1px solid #f0f1f3;">
                            <span style="display:block;color:#98a2b3;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Proposta</span>
                            <span style="display:block;color:#0f172a;font-size:19px;font-weight:800;font-family:'SF Mono',Consolas,Menlo,monospace;">#${propostaNo}</span>
                          </td>
                          <td width="50%" style="vertical-align:top;padding-left:16px;">
                            <span style="display:block;color:#98a2b3;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Cliente</span>
                            <span style="display:block;color:#0f172a;font-size:15px;font-weight:700;line-height:1.4;">${clienteNome}</span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:28px 32px 8px;">
                <p style="margin:0 0 22px;color:#344054;font-size:15px;line-height:1.7;">
                  ${theme.bodyHtml(primeiroNome, vendedorNome)}
                </p>

                ${
                  link
                    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                        <tr>
                          <td style="border-radius:10px;background-color:#0f172a;">
                            <a href="${link}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:14.5px;font-weight:700;text-decoration:none;border-radius:10px;">
                              Abrir proposta &nbsp;&rarr;
                            </a>
                          </td>
                        </tr>
                      </table>`
                    : ""
                }
              </td>
            </tr>

            <tr>
              <td style="padding:0 32px;">
                <hr style="border:none;border-top:1px solid #f0f1f3;margin:0;" />
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:20px 32px 28px;">
                <p style="margin:0;color:#98a2b3;font-size:12.5px;line-height:1.6;">
                  Este é um e-mail automático do <strong style="color:#667085;">CRM Eltech</strong>, ${theme.footerNote}. Nenhuma resposta é necessária.
                </p>
              </td>
            </tr>
          </table>

          <!-- Sub-footer -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin-top:24px;">
            <tr>
              <td align="center" style="color:#5b6472;font-size:12px;line-height:1.6;">
                &copy; ${ano} Eltech &middot; Todos os direitos reservados
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}

// Ícone minimalista de engrenagem (validação interna / produção) — outline, sem preenchimento
const GEAR_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="#bae6fd" stroke-width="2"/><path d="M19.4 13a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V19a2 2 0 11-4 0v-.09A1.65 1.65 0 009 17.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 13 1.65 1.65 0 003.17 12H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 6.91a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 3.09H9a1.65 1.65 0 001-1.51V1a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 6.6a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="#bae6fd" stroke-width="1.4"/></svg>`;

// Ícone minimalista de check (aceite do cliente) — outline circular
const CHECK_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;"><circle cx="12" cy="12" r="9" stroke="#bae6fd" stroke-width="2"/><path d="M8 12.5l2.5 2.5L16 9.5" stroke="#bae6fd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function buildPropostaValidadaEmail(input: PropostaStatusEmailInput): string {
  return buildStatusEmail(input, {
    preheader: `A proposta ${input.propostaNo} foi validada internamente e está pronta para seguir com ${input.clienteNome}.`,
    gradientFrom: "#334155",
    gradientTo: "#0f172a",
    badgeDotColor: "#bae6fd",
    badgeTextColor: "#e2e8f0",
    badgeLabel: "PROPOSTA VALIDADA",
    iconSvg: GEAR_ICON_SVG,
    title: "Validada e pronta para Produção ⚙️",
    subtitle: "A checagem interna aprovou a proposta. Ela já pode seguir para negociação com o cliente.",
    subtitleColor: "#cbd5e1",
    bodyHtml: (primeiroNome, vendedorNome) =>
      `Olá, <strong style="color:#0f172a;">${primeiroNome || vendedorNome || "vendedor"}</strong>. A proposta passou pela checagem interna e foi <strong>validada</strong>. Agora ela está liberada para você seguir com a negociação junto ao cliente.`,
    footerNote: "enviado sempre que uma proposta é validada internamente",
  });
}

export function buildPropostaAprovadaClienteEmail(input: PropostaStatusEmailInput): string {
  return buildStatusEmail(input, {
    preheader: `A proposta ${input.propostaNo} foi aprovada pelo cliente ${input.clienteNome} e já seguiu para a Produção.`,
    gradientFrom: "#1e5f7a",
    gradientTo: "#0d3348",
    badgeDotColor: "#7dd3fc",
    badgeTextColor: "#e0f2fe",
    badgeLabel: "PROPOSTA APROVADA",
    iconSvg: CHECK_ICON_SVG,
    title: "O cliente disse sim! 🎉",
    subtitle: "A proposta foi aprovada e liberada automaticamente para a Produção.",
    subtitleColor: "#bae6fd",
    bodyHtml: (primeiroNome, vendedorNome) =>
      `Olá, <strong style="color:#0f172a;">${primeiroNome || vendedorNome || "vendedor"}</strong>. A negociação chegou ao fim: o cliente confirmou a aprovação e os itens já foram enviados para a etapa de produção. Nenhuma ação adicional é necessária da sua parte agora — só acompanhar.`,
    footerNote: "enviado sempre que uma proposta é aprovada pelo cliente",
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
