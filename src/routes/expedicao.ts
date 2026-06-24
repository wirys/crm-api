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

export const expedicaoRoutes = new Elysia({ detail: { tags: ["Expedicao"] }, prefix: "/expedicao" })

    // ── GET /expedicao  ── propostas em expedição (ainda não concluídas) ────────
    .get("/", async ({ query }) => {
        const { representante, status, search, dtaInicio, dtaFim, userId, userGroup } = query as Record<string, string | undefined>;

        const uid     = Number(userId    || 0);
        const ugid    = Number(userGroup || 0);
        const isAdmin = [1, 2, 3, 5, 7].includes(ugid);

        const conds: string[] = [
            `t1.PropostaNo IS NOT NULL AND t1.PropostaNo <> ''`,
            `t1.idStatus NOT IN (4, 5)`,
            `t1.idStatus >= 3`,
        ];

        if (status)        conds.push(`t1.idStatus IN (${status.split(",").map(Number).filter(n => !isNaN(n)).join(",")})`);

        // Filtro de carteira
        if (representante) {
            conds.push(`t6.idUsuario IN (${representante.split(",").map(Number).filter(n => !isNaN(n)).join(",")})`);
        } else if (!isAdmin && uid > 0) {
            conds.push(`t6.idUsuario = ${uid}`);
        }

        if (dtaInicio)     conds.push(`t1.dtaCriacao >= '${dtaInicio}'`);
        if (dtaFim)        conds.push(`t1.dtaCriacao <= '${dtaFim} 23:59:59'`);
        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(t1.PropostaNo LIKE '%${s}%' OR t3.nomComercial LIKE '%${s}%' OR t3.nomContato LIKE '%${s}%' OR t3.CNPJ LIKE '%${s}%')`);
        }

        const where = `WHERE ${conds.join(" AND ")}`;

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
                TotalValor      = ISNULL(t1.TotalValor, 0),
                TotalKg         = ISNULL(t1.TotalKg, 0),
                Observacao      = ISNULL(t1.Observacao, ''),
                ObsChecagem     = ISNULL(t1.ObsChecagem, ''),
                dtaCriacao      = ISNULL(CONVERT(varchar(10), t1.dtaCriacao, 23), ''),
                dtaEnvio        = ISNULL(CONVERT(varchar(10), t1.dtaEnvio,   23), ''),
                dtaValidade     = ISNULL(CONVERT(varchar(10), t1.dtaValidade, 23), ''),
                Frete           = ISNULL(f.Titulo, ''),
                CondicaoPagamento = ISNULL(cp.Titulo, ''),
                Representante   = ISNULL(t6.Nome, 'N/D'),
                idRepresentante = ISNULL(t6.idUsuario, 0),
                QtdRastreios    = (SELECT COUNT(*) FROM CRM_ExpedicaoRastreio r WITH (NOLOCK) WHERE r.idProposta = t1.idProposta),
                QtdArquivos     = (SELECT COUNT(*) FROM CRM_ExpedicaoArquivo  a WITH (NOLOCK) WHERE a.idProposta = t1.idProposta)
            FROM CRM_Proposta AS t1 WITH (NOLOCK)
            LEFT JOIN CRM_Proposta_Status AS s  WITH (NOLOCK) ON t1.idStatus        = s.idStatus
            LEFT JOIN CRM_Contato         AS t3 WITH (NOLOCK) ON t1.idContato       = t3.idContato
            LEFT JOIN CRM_Proposta_Difal  AS d  WITH (NOLOCK) ON t1.idDifal         = d.idDifal
            LEFT JOIN CRM_Proposta_Frete  AS f  WITH (NOLOCK) ON t1.idFrete         = f.idFrete
            LEFT JOIN CRM_Proposta_CondicaoPagamento AS cp WITH (NOLOCK) ON t1.idCondicaoPagamento = cp.idCondicaoPagamento
            LEFT JOIN CRM_Usuario         AS t6 WITH (NOLOCK) ON t3.idRepresentante = t6.idUsuario
            ${where}
            ORDER BY t1.idProposta DESC
        `);

        return { data: conv(rows), total: rows.length };
    }, {
        query: t.Object({
            status:        t.Optional(t.String()),
            representante: t.Optional(t.String()),
            dtaInicio:     t.Optional(t.String()),
            dtaFim:        t.Optional(t.String()),
            search:        t.Optional(t.String()),
            userId:        t.Optional(t.String()),
            userGroup:     t.Optional(t.String()),
        })
    })

    // ── GET /expedicao/concluidos ── propostas concluídas (idStatus 4 ou 5) ────
    .get("/concluidos", async ({ query }) => {
        const { representante, search, dtaInicio, dtaFim, userId, userGroup } = query as Record<string, string | undefined>;

        const uid     = Number(userId    || 0);
        const ugid    = Number(userGroup || 0);
        const isAdmin = [1, 2, 3, 5, 7].includes(ugid);

        const conds: string[] = [`t1.idStatus IN (4, 5)`];

        // Filtro de carteira
        if (representante) {
            conds.push(`t6.idUsuario IN (${representante.split(",").map(Number).filter(n => !isNaN(n)).join(",")})`);
        } else if (!isAdmin && uid > 0) {
            conds.push(`t6.idUsuario = ${uid}`);
        }

        if (dtaInicio)     conds.push(`t1.dtaCriacao >= '${dtaInicio}'`);
        if (dtaFim)        conds.push(`t1.dtaCriacao <= '${dtaFim} 23:59:59'`);
        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(t1.PropostaNo LIKE '%${s}%' OR t3.nomComercial LIKE '%${s}%' OR t3.nomContato LIKE '%${s}%' OR t3.CNPJ LIKE '%${s}%')`);
        }

        const where = `WHERE ${conds.join(" AND ")}`;

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
                TotalValor      = ISNULL(t1.TotalValor, 0),
                TotalKg         = ISNULL(t1.TotalKg, 0),
                Observacao      = ISNULL(t1.Observacao, ''),
                dtaCriacao      = ISNULL(CONVERT(varchar(10), t1.dtaCriacao, 23), ''),
                dtaEnvio        = ISNULL(CONVERT(varchar(10), t1.dtaEnvio,   23), ''),
                Frete           = ISNULL(f.Titulo, ''),
                CondicaoPagamento = ISNULL(cp.Titulo, ''),
                Representante   = ISNULL(t6.Nome, 'N/D'),
                idRepresentante = ISNULL(t6.idUsuario, 0),
                QtdRastreios    = (SELECT COUNT(*) FROM CRM_ExpedicaoRastreio r WITH (NOLOCK) WHERE r.idProposta = t1.idProposta),
                QtdArquivos     = (SELECT COUNT(*) FROM CRM_ExpedicaoArquivo  a WITH (NOLOCK) WHERE a.idProposta = t1.idProposta)
            FROM CRM_Proposta AS t1 WITH (NOLOCK)
            LEFT JOIN CRM_Proposta_Status AS s  WITH (NOLOCK) ON t1.idStatus        = s.idStatus
            LEFT JOIN CRM_Contato         AS t3 WITH (NOLOCK) ON t1.idContato       = t3.idContato
            LEFT JOIN CRM_Proposta_Difal  AS d  WITH (NOLOCK) ON t1.idDifal         = d.idDifal
            LEFT JOIN CRM_Proposta_Frete  AS f  WITH (NOLOCK) ON t1.idFrete         = f.idFrete
            LEFT JOIN CRM_Proposta_CondicaoPagamento AS cp WITH (NOLOCK) ON t1.idCondicaoPagamento = cp.idCondicaoPagamento
            LEFT JOIN CRM_Usuario         AS t6 WITH (NOLOCK) ON t3.idRepresentante = t6.idUsuario
            ${where}
            ORDER BY t1.idProposta DESC
        `);

        return { data: conv(rows), total: rows.length };
    }, {
        query: t.Object({
            representante: t.Optional(t.String()),
            dtaInicio:     t.Optional(t.String()),
            dtaFim:        t.Optional(t.String()),
            search:        t.Optional(t.String()),
            userId:        t.Optional(t.String()),
            userGroup:     t.Optional(t.String()),
        })
    })

    // ── GET /expedicao/filter-options ─────────────────────────────────────────
    .get("/filter-options", async () => {
        const [statuses, reps] = await Promise.all([
            prisma.$queryRawUnsafe(`
                SELECT idStatus, Status, CorHTML FROM CRM_Proposta_Status WITH (NOLOCK)
                WHERE idStatus >= 3
                ORDER BY idStatus
            `),
            prisma.$queryRawUnsafe(`SELECT idUsuario, Nome FROM CRM_Usuario WITH (NOLOCK) WHERE flaAtivo = 1 ORDER BY Nome`),
        ]);
        return {
            statuses:       conv(statuses).map((s: any) => ({ value: String(s.idStatus), label: s.Status, cor: s.CorHTML })),
            representantes: conv(reps).map((r: any) => ({ value: String(r.idUsuario), label: r.Nome })),
        };
    })

    // ── GET /expedicao/:id/rastreios ──────────────────────────────────────────
    .get("/:id/rastreios", async ({ params }) => {
        const id = Number(params.id);
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                id, idProposta,
                RastreioCodigo  = ISNULL(RastreioCodigo, ''),
                RastreioUrl     = ISNULL(RastreioUrl, ''),
                RastreioMsg     = ISNULL(RastreioMsg, ''),
                WhatsApp        = ISNULL(WhatsApp, ''),
                flaMsgEnviada   = ISNULL(flaMsgEnviada, 0),
                PrimeiroNome    = ISNULL(PrimeiroNome, ''),
                UltimoNome      = ISNULL(UltimoNome, ''),
                DtaCadastro     = ISNULL(CONVERT(varchar(16), DtaCadastro, 120), '')
            FROM CRM_ExpedicaoRastreio WITH (NOLOCK)
            WHERE idProposta = ${id}
            ORDER BY DtaCadastro DESC
        `);
        return conv(rows);
    }, { params: t.Object({ id: t.String() }) })

    // ── POST /expedicao/:id/rastreio ──────────────────────────────────────────
    .post("/:id/rastreio", async ({ params, body, set }) => {
        const id = Number(params.id);
        const codigo = String(body.RastreioCodigo ?? "").replace(/'/g, "''");
        const url    = String(body.RastreioUrl    ?? "").replace(/'/g, "''");
        const msg    = String(body.RastreioMsg    ?? "").replace(/'/g, "''");
        const whats  = String(body.WhatsApp       ?? "").replace(/'/g, "''");
        try {
            await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_ExpedicaoRastreio (idProposta, RastreioCodigo, RastreioUrl, RastreioMsg, WhatsApp, DtaCadastro, flaMsgEnviada)
                VALUES (${id}, '${codigo}', '${url}', '${msg}', '${whats}', GETDATE(), 0)
            `);
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao adicionar rastreio" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body:   t.Object({
            RastreioCodigo: t.String(),
            RastreioUrl:    t.Optional(t.String()),
            RastreioMsg:    t.Optional(t.String()),
            WhatsApp:       t.Optional(t.String()),
        }),
    })

    // ── DELETE /expedicao/rastreio/:rastreioId ────────────────────────────────
    .delete("/rastreio/:rastreioId", async ({ params, set }) => {
        const rid = Number(params.rastreioId);
        try {
            await prisma.$queryRawUnsafe(`DELETE FROM CRM_ExpedicaoRastreio WHERE id = ${rid}`);
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao remover rastreio" };
        }
    }, { params: t.Object({ rastreioId: t.String() }) })

    // ── GET /expedicao/:id/arquivos ───────────────────────────────────────────
    .get("/:id/arquivos", async ({ params }) => {
        const id = Number(params.id);
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT id, idProposta,
                ArquivoNome    = ISNULL(ArquivoNome, ''),
                ArquivoTipo    = ISNULL(ArquivoTipo, ''),
                CaminhoArquivo = ISNULL(CaminhoArquivo, ''),
                dtaCriacao     = ISNULL(CONVERT(varchar(16), dtaCriacao, 120), '')
            FROM CRM_ExpedicaoArquivo WITH (NOLOCK)
            WHERE idProposta = ${id}
            ORDER BY dtaCriacao DESC
        `);
        return conv(rows);
    }, { params: t.Object({ id: t.String() }) })

    // ── POST /expedicao/:id/arquivo ───────────────────────────────────────────
    .post("/:id/arquivo", async ({ params, body, set }) => {
        const id       = Number(params.id);
        const { ArquivoNome, ArquivoTipo, CaminhoArquivo, idUsuario } = body as any;
        const nome     = String(ArquivoNome    ?? "").replace(/'/g, "''");
        const tipo     = String(ArquivoTipo    ?? "").replace(/'/g, "''");
        const caminho  = String(CaminhoArquivo ?? "").replace(/'/g, "''");
        const uid      = Number(idUsuario ?? 0);
        try {
            await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_ExpedicaoArquivo (idProposta, ArquivoNome, ArquivoTipo, CaminhoArquivo, dtaCriacao, idUsuario)
                VALUES (${id}, '${nome}', '${tipo}', '${caminho}', GETDATE(), ${uid || "NULL"})
            `);
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao salvar arquivo" };
        }
    }, { params: t.Object({ id: t.String() }) })

    // ── DELETE /expedicao/arquivo/:arquivoId ──────────────────────────────────
    .delete("/arquivo/:arquivoId", async ({ params, set }) => {
        const aid = Number(params.arquivoId);
        try {
            await prisma.$queryRawUnsafe(`DELETE FROM CRM_ExpedicaoArquivo WHERE id = ${aid}`);
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao remover arquivo" };
        }
    }, { params: t.Object({ arquivoId: t.String() }) })

    // ── GET /expedicao/:id/updates ────────────────────────────────────────────
    .get("/:id/updates", async ({ params }) => {
        const id = Number(params.id);
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                u.idExpedicaoUpdate,
                u.idProposta,
                UpdateContent   = ISNULL(u.UpdateContent, ''),
                UserName        = ISNULL(usr.Nome, u.[User]),
                CreatedAt       = ISNULL(CONVERT(varchar(16), u.CreatedAt, 120), '')
            FROM CRM_ExpedicaoUpdate AS u WITH (NOLOCK)
            LEFT JOIN CRM_Usuario AS usr WITH (NOLOCK) ON u.idUsuario = usr.idUsuario
            WHERE u.idProposta = ${id}
            ORDER BY u.CreatedAt DESC
        `);
        return conv(rows);
    }, { params: t.Object({ id: t.String() }) })

    // ── POST /expedicao/:id/update ────────────────────────────────────────────
    .post("/:id/update", async ({ params, body, set }) => {
        const id      = Number(params.id);
        const content = String(body.UpdateContent ?? "").replace(/'/g, "''");
        const userId  = Number(body.idUsuario ?? 0);
        try {
            await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_ExpedicaoUpdate (idProposta, UpdateContent, CreatedAt, idUsuario)
                VALUES (${id}, '${content}', GETDATE(), ${userId || "NULL"})
            `);
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao adicionar update" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body:   t.Object({
            UpdateContent: t.String(),
            idUsuario:     t.Optional(t.Number()),
        }),
    })

    // ── PATCH /expedicao/:id/status ───────────────────────────────────────────
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
    });
