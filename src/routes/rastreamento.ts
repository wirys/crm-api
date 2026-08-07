import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function conv(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "bigint") return Number(obj);
    if (obj instanceof Date) return obj;
    if (Array.isArray(obj)) return obj.map(conv);
    if (typeof obj === "object") {
        if (typeof obj.toNumber === "function") return obj.toNumber();
        const out: any = {};
        for (const k in obj) out[k] = conv(obj[k]);
        return out;
    }
    return obj;
}

export const rastreamentoRoutes = new Elysia({ detail: { tags: ["Expedicao"] }, prefix: "/rastreamento" })

    // ── GET /rastreamento ─────────────────────────────────────────────────────
    .get("/", async ({ query }) => {
        const { search, dtaInicio, dtaFim, userId, userGroup } = query as Record<string, string | undefined>;

        const uid     = Number(userId    || 0);
        const ugid    = Number(userGroup || 0);
        const isAdmin = [1, 2, 3, 5, 7].includes(ugid);

        const conds: string[] = [];

        if (!isAdmin && uid > 0) conds.push(`c.idRepresentante = ${uid}`);

        if (dtaInicio) conds.push(`r.DtaCadastro >= '${dtaInicio}'`);
        if (dtaFim)    conds.push(`r.DtaCadastro <= '${dtaFim} 23:59:59'`);
        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(r.RastreioCodigo LIKE '%${s}%' OR p.PropostaNo LIKE '%${s}%' OR ISNULL(NULLIF(c.nomComercial,''), c.nomContato) LIKE '%${s}%')`);
        }

        const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                r.id,
                r.idProposta,
                PropostaNo      = ISNULL(p.PropostaNo, ''),
                ClienteNome     = ISNULL(NULLIF(c.nomComercial, ''), c.nomContato),
                RastreioCodigo  = ISNULL(r.RastreioCodigo, ''),
                RastreioUrl     = ISNULL(r.RastreioUrl, ''),
                RastreioMsg     = ISNULL(r.RastreioMsg, ''),
                WhatsApp        = ISNULL(r.WhatsApp, ''),
                flaMsgEnviada   = ISNULL(r.flaMsgEnviada, 0),
                PrimeiroNome    = ISNULL(r.PrimeiroNome, ''),
                UltimoNome      = ISNULL(r.UltimoNome, ''),
                DtaCadastro     = ISNULL(CONVERT(varchar(16), r.DtaCadastro, 120), '')
            FROM CRM_ExpedicaoRastreio r WITH (NOLOCK)
            JOIN CRM_Proposta p WITH (NOLOCK) ON r.idProposta = p.idProposta
            LEFT JOIN CRM_Contato c WITH (NOLOCK) ON p.idContato = c.idContato
            ${where}
            ORDER BY r.DtaCadastro DESC
        `);

        return { data: conv(rows), total: rows.length };
    }, {
        query: t.Object({
            search:    t.Optional(t.String()),
            dtaInicio: t.Optional(t.String()),
            dtaFim:    t.Optional(t.String()),
            userId:    t.Optional(t.String()),
            userGroup: t.Optional(t.String()),
        }),
        detail: {
            summary: "Listar rastreios de expedição",
            description: "Retorna a lista de códigos de rastreio das propostas, com dados do cliente e status de envio da mensagem de WhatsApp. Permite filtrar por período de cadastro (`dtaInicio`/`dtaFim`) e por busca textual (`search`) no código de rastreio, número da proposta ou nome do cliente. Se o usuário não pertencer a um grupo administrativo (idGrupo 1, 2, 3, 5 ou 7), os resultados são restritos aos registros do próprio representante (`userId`).",
        },
    })

    // ── PATCH /rastreamento/:id/enviada ───────────────────────────────────────
    .patch("/:id/enviada", async ({ params, body, set }) => {
        const id = Number(params.id);
        const val = body.flaMsgEnviada ? 1 : 0;
        try {
            await prisma.$queryRawUnsafe(
                `UPDATE CRM_ExpedicaoRastreio SET flaMsgEnviada = ${val} WHERE id = ${id}`
            );
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao atualizar status de envio" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body:   t.Object({ flaMsgEnviada: t.Boolean() }),
        detail: {
            summary: "Atualizar status de envio da mensagem de rastreio",
            description: "Marca o registro de rastreamento identificado por `id` como enviado (`flaMsgEnviada = 1`) ou não enviado (`flaMsgEnviada = 0`), refletindo se a mensagem de WhatsApp com o código de rastreio já foi enviada ao cliente.",
        },
    });
