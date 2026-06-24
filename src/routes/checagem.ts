import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function conv(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "bigint") return Number(obj);
    if (obj instanceof Date) return obj;
    if (Array.isArray(obj)) return obj.map(conv);
    if (typeof obj === "object") {
        // Prisma Decimal
        if (typeof obj.toNumber === "function") return obj.toNumber();
        const out: any = {};
        for (const k in obj) out[k] = conv(obj[k]);
        return out;
    }
    return obj;
}

export const checagemRoutes = new Elysia({ detail: { tags: ["Propostas"] }, prefix: "/checagem" })

    // ── GET /checagem  ─── lista completa de propostas p/ checagem ────────────
    .get("/", async ({ query }) => {
        const { status, representante, dtaInicio, dtaFim, search, pendentes, userId, userGroup } = query as Record<string, string | undefined>;

        const uid       = Number(userId   || 0);
        const ugid      = Number(userGroup || 0);
        const isAdmin   = [1, 2, 3, 5, 7].includes(ugid);

        const conds: string[] = [];

        if (pendentes === "1") {
            conds.push(`(t1.PropostaNo IS NOT NULL AND t1.PropostaNo <> '')`);
        }
        if (status)       conds.push(`t1.idStatus IN (${status.split(",").map(Number).filter(n => !isNaN(n)).join(",")})`);

        // Filtro de carteira: admin vê tudo, vendedor só vê as próprias
        if (representante) {
            conds.push(`t6.idUsuario IN (${representante.split(",").map(Number).filter(n => !isNaN(n)).join(",")})`);
        } else if (!isAdmin && uid > 0) {
            conds.push(`t6.idUsuario = ${uid}`);
        }

        if (dtaInicio)    conds.push(`t1.dtaCriacao >= '${dtaInicio}'`);
        if (dtaFim)       conds.push(`t1.dtaCriacao <= '${dtaFim} 23:59:59'`);
        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(t1.PropostaNo LIKE '%${s}%' OR t3.nomComercial LIKE '%${s}%' OR t3.nomContato LIKE '%${s}%' OR t3.CNPJ LIKE '%${s}%')`);
        }

        const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                t1.idProposta,
                PropostaNo      = ISNULL(t1.PropostaNo, ''),
                t1.idStatus,
                Status          = ISNULL(s.Status, 'N/D'),
                CorHTML         = ISNULL(s.CorHTML, '#6b7280'),
                t1.idContato,
                ClienteNome     = ISNULL(NULLIF(t3.nomComercial,''), t3.nomContato),
                CNPJ            = ISNULL(t3.CNPJ, ''),
                UF              = ISNULL(d.UF, ''),
                CalculaDifal    = ISNULL(t1.CalculaDifal, 0),
                Desconto        = ISNULL(t1.Desconto, 0),
                TotalValor      = ISNULL(t1.TotalValor, 0),
                TotalKg         = ISNULL(t1.TotalKg, 0),
                ObsChecagem     = ISNULL(t1.ObsChecagem, ''),
                Observacao      = ISNULL(t1.Observacao, ''),
                dtaCriacao      = ISNULL(CONVERT(varchar(10), t1.dtaCriacao, 23), ''),
                dtaEnvio        = ISNULL(CONVERT(varchar(10), t1.dtaEnvio,   23), ''),
                dtaValidade     = ISNULL(CONVERT(varchar(10), t1.dtaValidade, 23), ''),
                Frete           = ISNULL(f.Titulo, ''),
                CondicaoPagamento = ISNULL(cp.Titulo, ''),
                Representante   = ISNULL(t6.Nome, 'N/D'),
                RepresentanteEmail = ISNULL(t6.Email, ''),
                idRepresentante = ISNULL(t6.idUsuario, 0),
                FundoPobreza    = ISNULL(t1.FundoPobreza, 0),
                Possibilidade   = ISNULL(t1.Possibilidade, 0),
                GanhoEstimado   = ISNULL(t1.GanhoEstimado, 0)
            FROM CRM_Proposta AS t1 WITH (NOLOCK)
            LEFT JOIN CRM_Proposta_Status AS s  WITH (NOLOCK) ON t1.idStatus          = s.idStatus
            LEFT JOIN CRM_Contato         AS t3 WITH (NOLOCK) ON t1.idContato         = t3.idContato
            LEFT JOIN CRM_Proposta_Difal  AS d  WITH (NOLOCK) ON t1.idDifal           = d.idDifal
            LEFT JOIN CRM_Proposta_Frete  AS f  WITH (NOLOCK) ON t1.idFrete           = f.idFrete
            LEFT JOIN CRM_Proposta_CondicaoPagamento AS cp WITH (NOLOCK) ON t1.idCondicaoPagamento = cp.idCondicaoPagamento
            LEFT JOIN CRM_Usuario         AS t6 WITH (NOLOCK) ON t3.idRepresentante   = t6.idUsuario
            ${where}
            ORDER BY t1.idProposta DESC
        `);

        return { data: conv(rows), total: rows.length };
    }, {
        query: t.Object({
            status:         t.Optional(t.String()),
            representante:  t.Optional(t.String()),
            dtaInicio:      t.Optional(t.String()),
            dtaFim:         t.Optional(t.String()),
            search:         t.Optional(t.String()),
            pendentes:      t.Optional(t.String()),
            userId:         t.Optional(t.String()),
            userGroup:      t.Optional(t.String()),
        })
    })

    // ── GET /checagem/statuses ────────────────────────────────────────────────
    .get("/statuses", async () => {
        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT idStatus, Status, CorHTML FROM CRM_Proposta_Status WITH (NOLOCK) ORDER BY idStatus`
        );
        return conv(rows);
    })

    // ── GET /checagem/filter-options ──────────────────────────────────────────
    .get("/filter-options", async () => {
        const [statuses, reps] = await Promise.all([
            prisma.$queryRawUnsafe(`SELECT idStatus, Status, CorHTML FROM CRM_Proposta_Status WITH (NOLOCK) ORDER BY idStatus`),
            prisma.$queryRawUnsafe(`SELECT idUsuario, Nome FROM CRM_Usuario WITH (NOLOCK) WHERE flaAtivo = 1 ORDER BY Nome`),
        ]);
        return {
            statuses: conv(statuses).map((s: any) => ({ value: String(s.idStatus), label: s.Status, cor: s.CorHTML })),
            representantes: conv(reps).map((r: any) => ({ value: String(r.idUsuario), label: r.Nome })),
        };
    })

    // ── PATCH /checagem/:id/status ────────────────────────────────────────────
    .patch("/:id/status", async ({ params, body, set }) => {
        const id = Number(params.id);
        const { idStatus } = body;
        try {
            await prisma.$queryRawUnsafe(
                `UPDATE CRM_Proposta SET idStatus = ${Number(idStatus)} WHERE idProposta = ${id}`
            );
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao atualizar status" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body:   t.Object({ idStatus: t.Number() }),
    })

    // ── PATCH /checagem/:id/obs ───────────────────────────────────────────────
    .patch("/:id/obs", async ({ params, body, set }) => {
        const id = Number(params.id);
        const obs = String(body.ObsChecagem ?? "").replace(/'/g, "''");
        try {
            await prisma.$queryRawUnsafe(
                `UPDATE CRM_Proposta SET ObsChecagem = '${obs}' WHERE idProposta = ${id}`
            );
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao atualizar observação" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body:   t.Object({ ObsChecagem: t.String() }),
    })

    // ── POST /checagem/:id/reprovar ───────────────────────────────────────────
    .post("/:id/reprovar", async ({ params, body, set }) => {
        const id = Number(params.id);
        const obs = String(body.Observacao ?? "").replace(/'/g, "''");
        try {
            // 1) Insert reprovacao record
            await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_Proposta_Reprovacao (idProposta, dtaReprovacao, Observacao)
                VALUES (${id}, GETDATE(), '${obs}')
            `);
            // 2) Set status to "Reprovado" (idStatus = 6 based on proposals.ts map)
            await prisma.$queryRawUnsafe(
                `UPDATE CRM_Proposta SET idStatus = 6, ObsChecagem = '${obs}' WHERE idProposta = ${id}`
            );
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao reprovar proposta" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body:   t.Object({ Observacao: t.Optional(t.String()) }),
    })

    // ── POST /checagem/:id/aprovar ────────────────────────────────────────────
    .post("/:id/aprovar", async ({ params, body, set }) => {
        const id = Number(params.id);
        const obs = String(body.ObsChecagem ?? "").replace(/'/g, "''");
        try {
            // Status 3 = Aprovado (from proposals.ts statusMap)
            const sets = obs
                ? `idStatus = 3, ObsChecagem = '${obs}'`
                : `idStatus = 3`;
            await prisma.$queryRawUnsafe(
                `UPDATE CRM_Proposta SET ${sets} WHERE idProposta = ${id}`
            );
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao aprovar proposta" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body:   t.Object({ ObsChecagem: t.Optional(t.String()) }),
    })

    // ── GET /checagem/:id/reprovacoes ─────────────────────────────────────────
    .get("/:id/reprovacoes", async ({ params }) => {
        const id = Number(params.id);
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                idReprovacao,
                idProposta,
                Observacao,
                dtaReprovacao = ISNULL(CONVERT(varchar(16), dtaReprovacao, 120), '')
            FROM CRM_Proposta_Reprovacao WITH (NOLOCK)
            WHERE idProposta = ${id}
            ORDER BY dtaReprovacao DESC
        `);
        return conv(rows);
    }, {
        params: t.Object({ id: t.String() }),
    });
