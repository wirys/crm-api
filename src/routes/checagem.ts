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
        }),
        detail: {
            summary: "Listar propostas para checagem",
            description: "Retorna a lista completa de propostas com dados de status, cliente, representante, valores e datas para a tela de checagem. Aceita filtros por status (lista de ids), representante(s), período de criação (dtaInicio/dtaFim), busca textual (número da proposta, nome/contato/CNPJ do cliente) e um filtro de pendentes (apenas propostas com PropostaNo preenchido). Vendedores (userGroup fora de 1,2,3,5,7) só visualizam propostas da própria carteira, salvo quando um filtro de representante é informado explicitamente.",
        },
    })

    // ── GET /checagem/statuses ────────────────────────────────────────────────
    .get("/statuses", async () => {
        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT idStatus, Status, CorHTML FROM CRM_Proposta_Status WITH (NOLOCK) ORDER BY idStatus`
        );
        return conv(rows);
    }, {
        detail: {
            summary: "Listar status de proposta",
            description: "Retorna todos os status possíveis de proposta (id, descrição e cor em HTML) cadastrados em CRM_Proposta_Status, ordenados por idStatus. Usado para popular selects e legendas na tela de checagem.",
        },
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
    }, {
        detail: {
            summary: "Listar opções de filtro da checagem",
            description: "Retorna, em paralelo, a lista de status de proposta e a lista de usuários ativos (representantes) formatadas como opções (value/label) para alimentar os filtros de status e representante da tela de checagem.",
        },
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
        detail: {
            summary: "Atualizar status de uma proposta",
            description: "Atualiza diretamente o campo idStatus da proposta identificada por :id em CRM_Proposta. Não valida o valor recebido contra a lista de status existentes; qualquer id numérico é aceito.",
        },
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
        detail: {
            summary: "Atualizar observação de checagem",
            description: "Atualiza o campo ObsChecagem da proposta identificada por :id em CRM_Proposta. Não altera o status da proposta, apenas o texto de observação usado na etapa de checagem.",
        },
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
        detail: {
            summary: "Reprovar proposta",
            description: "Reprova a proposta identificada por :id: insere um registro histórico em CRM_Proposta_Reprovacao com a observação informada e a data atual, e em seguida atualiza a proposta em CRM_Proposta para idStatus = 6 (Reprovado), gravando a mesma observação em ObsChecagem.",
        },
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
        detail: {
            summary: "Aprovar proposta",
            description: "Aprova a proposta identificada por :id, atualizando idStatus para 3 (Aprovado) em CRM_Proposta. Se uma observação (ObsChecagem) for informada, ela também é gravada junto com a mudança de status.",
        },
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
        detail: {
            summary: "Listar histórico de reprovações de uma proposta",
            description: "Retorna todos os registros de reprovação (observação e data, mais recente primeiro) da proposta identificada por :id, consultando a tabela CRM_Proposta_Reprovacao.",
        },
    });
