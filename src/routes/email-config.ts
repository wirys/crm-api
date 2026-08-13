import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function maskSecret(value: string | null): string | null {
    if (!value) return value;
    if (value.length <= 4) return "****";
    return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}

export const emailConfigRoutes = new Elysia({ detail: { tags: ["Admin"] }, prefix: "/admin/email-config" })

    .get("/", async () => {
        const config = await prisma.cRM_EmailConfig.findFirst({
            where: { flaAtivo: true },
            orderBy: { id: "desc" },
        });

        if (!config) return { empty: true };

        return {
            id: config.id,
            Provider: config.Provider,
            ResendApiKey: maskSecret(config.ResendApiKey),
            SmtpHost: config.SmtpHost,
            SmtpPort: config.SmtpPort,
            SmtpUser: config.SmtpUser,
            SmtpPassword: maskSecret(config.SmtpPassword),
            SmtpSecure: config.SmtpSecure,
            FromEmail: config.FromEmail,
            FromName: config.FromName,
        };
    }, {
        detail: {
            summary: "Buscar configuração de e-mail ativa",
            description: "Retorna a configuração de envio de e-mail atualmente ativa (Resend ou SMTP). Segredos (API key / senha) são retornados mascarados.",
        },
    })

    .put("/", async ({ body, set }) => {
        if (body.Provider !== "resend" && body.Provider !== "smtp") {
            set.status = 400;
            return { error: "Provider deve ser 'resend' ou 'smtp'" };
        }
        if (!body.FromEmail) {
            set.status = 400;
            return { error: "FromEmail é obrigatório" };
        }
        if (body.Provider === "resend" && !body.ResendApiKey) {
            set.status = 400;
            return { error: "ResendApiKey é obrigatório para o provider resend" };
        }
        if (body.Provider === "smtp" && (!body.SmtpHost || !body.SmtpUser || !body.SmtpPassword)) {
            set.status = 400;
            return { error: "SmtpHost, SmtpUser e SmtpPassword são obrigatórios para o provider smtp" };
        }

        const existing = await prisma.cRM_EmailConfig.findFirst({
            where: { flaAtivo: true },
            orderBy: { id: "desc" },
        });

        const data = {
            Provider: body.Provider,
            ResendApiKey: body.ResendApiKey ?? existing?.ResendApiKey ?? null,
            SmtpHost: body.SmtpHost ?? null,
            SmtpPort: body.SmtpPort ?? null,
            SmtpUser: body.SmtpUser ?? null,
            SmtpPassword: body.SmtpPassword ?? existing?.SmtpPassword ?? null,
            SmtpSecure: body.SmtpSecure ?? false,
            FromEmail: body.FromEmail,
            FromName: body.FromName ?? null,
            flaAtivo: true,
            dtaAlteracao: new Date(),
        };

        if (existing) {
            await prisma.cRM_EmailConfig.update({ where: { id: existing.id }, data });
        } else {
            await prisma.cRM_EmailConfig.create({ data });
        }

        return { success: true };
    }, {
        body: t.Object({
            Provider: t.String(),
            ResendApiKey: t.Optional(t.String()),
            SmtpHost: t.Optional(t.String()),
            SmtpPort: t.Optional(t.Number()),
            SmtpUser: t.Optional(t.String()),
            SmtpPassword: t.Optional(t.String()),
            SmtpSecure: t.Optional(t.Boolean()),
            FromEmail: t.String(),
            FromName: t.Optional(t.String()),
        }),
        detail: {
            summary: "Salvar configuração de e-mail",
            description: "Cria ou atualiza a configuração ativa de envio de e-mail (Resend ou SMTP). Se ResendApiKey/SmtpPassword não forem enviados, o valor anterior é preservado (evita reenviar o segredo mascarado de volta).",
        },
    });
