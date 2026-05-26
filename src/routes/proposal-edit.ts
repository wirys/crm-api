import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function convertBigIntToNumber(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return Number(obj);
    if (obj instanceof Date) return obj;
    if (typeof obj === 'object') {
        if (Array.isArray(obj)) return obj.map(item => convertBigIntToNumber(item));
        if (obj.constructor?.name === 'Decimal' || (obj.s !== undefined && obj.e !== undefined && obj.d !== undefined)) {
            return Number(obj.toString?.() ?? obj);
        }
        const converted: any = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                converted[key] = convertBigIntToNumber(obj[key]);
            }
        }
        return converted;
    }
    return obj;
}

export const proposalEditRoutes = new Elysia({ prefix: "/proposal-edit" })
    .get("/:id", async ({ params }) => {
        const id = Number(params.id);
        const results: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                t1.idProposta,
                t1.PropostaNo,
                t1.idStatus,
                t1.idContato,
                t1.idUsuario,
                t1.TotalValor,
                t1.TotalKg,
                t1.Desconto,
                t1.Observacao,
                t1.Possibilidade,
                t1.GanhoEstimado,
                t1.Area,
                t1.ValorM2,
                t1.FundoPobreza,
                t1.CalculaDifal,
                t1.idFrete,
                t1.idCondicaoPagamento,
                t1.idOutros,
                t1.ValorOutros,
                t1.Valor,
                t1.idDifal,
                DataPossivel = CASE WHEN t1.DataPossivel IS NULL THEN '' ELSE FORMAT(t1.DataPossivel, 'yyyy-MM-dd') END,
                dtaValidade = CASE WHEN t1.dtaValidade IS NULL THEN '' ELSE FORMAT(t1.dtaValidade, 'yyyy-MM-dd') END,
                dtaCriacao = CASE WHEN t1.dtaCriacao IS NULL THEN '' ELSE FORMAT(t1.dtaCriacao, 'dd/MM/yyyy') END,
                t1.ObsChecagem,
                UF = t2.UF,
                ClienteNome = CASE WHEN t3.nomComercial IS NOT NULL AND t3.nomComercial <> '' THEN t3.nomComercial ELSE t3.nomContato END,
                Status = t4.Status,
                CorHTML = t4.CorHTML
            FROM CRM_Proposta AS t1
            LEFT OUTER JOIN CRM_Proposta_Difal AS t2 ON t1.idDifal = t2.idDifal
            LEFT OUTER JOIN CRM_Contato AS t3 ON t1.idContato = t3.idContato
            LEFT OUTER JOIN CRM_Proposta_Status AS t4 ON t1.idStatus = t4.idStatus
            WHERE t1.idProposta = ${id}
        `);
        if (!results.length) return { error: "Proposta não encontrada" };
        return convertBigIntToNumber(results[0]);
    })
    .get("/commercial/:id", async ({ params }) => {
        const id = Number(params.id);
        const results: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                t1.PropostaNo,
                t1.ObsChecagem,
                t1.ValorM2,
                ClienteNome = CASE WHEN t3.nomComercial IS NOT NULL AND t3.nomComercial <> '' THEN t3.nomComercial ELSE t3.nomContato END,
                CNPJ = ISNULL(t3.CNPJ, ''),
                Contato = ISNULL(t3.nomContato, ''),
                Telefone = ISNULL(t3.Telefone, ''),
                Email = ISNULL(t3.email, ''),
                Frete = ISNULL(t5.Titulo, ''),
                CondicaoPagamento = ISNULL(t6.Titulo, ''),
                dtaCriacao = CASE WHEN t1.dtaCriacao IS NULL THEN '' ELSE FORMAT(t1.dtaCriacao, 'dd/MM/yyyy') END,
                Representante = ISNULL(t7.Nome, ''),
                RepresentanteEmail = ISNULL(t7.Email, ''),
                RepresentanteTelefone = ISNULL(t7.Telefone, '')
            FROM CRM_Proposta AS t1
            LEFT OUTER JOIN CRM_Contato AS t3 ON t1.idContato = t3.idContato
            LEFT OUTER JOIN CRM_Proposta_Frete AS t5 ON t1.idFrete = t5.idFrete
            LEFT OUTER JOIN CRM_Proposta_CondicaoPagamento AS t6 ON t1.idCondicaoPagamento = t6.idCondicaoPagamento
            LEFT OUTER JOIN CRM_Usuario AS t7 ON t3.idRepresentante = t7.idUsuario
            WHERE t1.idProposta = ${id}
        `);
        if (!results.length) return { error: "Proposta não encontrada" };
        const r = results[0];
        return {
            propostaNo: r.PropostaNo || "",
            clienteNome: r.ClienteNome || "",
            cnpj: r.CNPJ || "",
            contato: r.Contato || "",
            telefone: r.Telefone || "",
            email: r.Email || "",
            frete: r.Frete || "",
            condicaoPagamento: r.CondicaoPagamento || "",
            dtaCriacao: r.dtaCriacao || "",
            observacao: r.ObsChecagem || "",
            valorM2: Number(r.ValorM2 || 0),
            representante: r.Representante || "",
            representanteEmail: r.RepresentanteEmail || "",
            representanteTelefone: r.RepresentanteTelefone || "",
        };
    })
    .get("/:id/items", async ({ params }) => {
        const id = Number(params.id);
        const results: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                t1.idPropostaDetalhe,
                t1.idProposta,
                t1.idMaterial,
                t1.idComposicao,
                t1.idComposicaoDetalhe,
                t1.idEtapa,
                nomEtapa        = ISNULL(e.Etapa, ''),
                OrdemEtapa      = ISNULL(e.Ordem, 0),
                t1.Quantidade,
                t1.Desconto,
                t1.MaterialDescricao,
                nomMaterial     = ISNULL(t2.nomMaterial, t1.MaterialDescricao),
                CodMaterial     = ISNULL(t2.CodMaterial, ''),
                t2.NCM,
                PesoEmbalagem   = ISNULL(t2.PesoEmbalagem, 0),
                PrecoKg         = ISNULL(t2.PrecoKg, 0),
                ValorEmbalagem  = ISNULL(
                    NULLIF(t2.ValorEmbalagem, 0),
                    CASE
                        WHEN ROUND(ISNULL(t2.IPI, 0), 0) = 18 THEN ISNULL(CAST(t2.PrecoKg18 AS FLOAT), ISNULL(t2.PrecoKg, 0))
                        WHEN ROUND(ISNULL(t2.IPI, 0), 0) = 12 THEN ISNULL(CAST(t2.PrecoKg12 AS FLOAT), ISNULL(t2.PrecoKg, 0))
                        WHEN ROUND(ISNULL(t2.IPI, 0), 0) = 7  THEN ISNULL(CAST(t2.PrecoKg07 AS FLOAT), ISNULL(t2.PrecoKg, 0))
                        ELSE ISNULL(t2.PrecoKg, 0)
                    END * ISNULL(t2.PesoEmbalagem, 0)
                ),
                IPI             = ISNULL(t2.IPI, 0)
            FROM CRM_Proposta_Detalhe AS t1
            LEFT OUTER JOIN CRM_Produto_Material AS t2 ON t1.idMaterial = t2.idMaterial AND t1.idMaterial > 0
            LEFT OUTER JOIN CRM_Proposta_Etapa AS e ON t1.idEtapa = e.idEtapa
            WHERE t1.idProposta = ${id}
            ORDER BY ISNULL(e.Ordem, 9999), t1.idComposicao, t1.idComposicaoDetalhe, t1.idPropostaDetalhe
        `);
        return convertBigIntToNumber(results);
    })
    .get("/:id/totals", async ({ params }) => {
        const id = Number(params.id);
        // First get PropostaNo
        const prop: any[] = await prisma.$queryRawUnsafe(
            `SELECT PropostaNo FROM CRM_Proposta WHERE idProposta = ${id}`
        );
        if (!prop.length) return [];
        const propostaNo = prop[0].PropostaNo;
        if (!propostaNo) return [];

        const results: any[] = await prisma.$queryRawUnsafe(
            `EXEC sp_CRMPropostaDetalhe @PropostaNo = '${propostaNo}'`
        );
        return convertBigIntToNumber(results);
    })
    .get("/products", async () => {
        const results: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                t1.idMaterial,
                t1.nomMaterial AS Descricao,
                t1.CodMaterial AS Codigo,
                t1.idMaterialGrupo,
                t2.nomGrupo AS Grupo,
                flaComposicao = ISNULL(t1.flaComposicao, 0)
            FROM CRM_Produto_Material AS t1
            LEFT OUTER JOIN CRM_Produto_MaterialGrupo AS t2 ON t1.idMaterialGrupo = t2.idMaterialGrupo
            WHERE t1.flaAtivo = 1
            ORDER BY t2.nomGrupo, t1.nomMaterial
        `);
        return convertBigIntToNumber(results);
    })
    .get("/products/search", async ({ query }) => {
        const q = query.q || "";
        if (!q) return [];
        const results: any[] = await prisma.$queryRawUnsafe(`
            SELECT TOP 50
                t1.idMaterial,
                t1.nomMaterial AS Descricao,
                t1.CodMaterial AS Codigo,
                t1.idMaterialGrupo,
                t2.nomGrupo AS Grupo,
                flaComposicao = ISNULL(t1.flaComposicao, 0)
            FROM CRM_Produto_Material AS t1
            LEFT OUTER JOIN CRM_Produto_MaterialGrupo AS t2 ON t1.idMaterialGrupo = t2.idMaterialGrupo
            WHERE t1.flaAtivo = 1
                AND (t1.nomMaterial LIKE '%${q}%' OR t1.CodMaterial LIKE '%${q}%')
            ORDER BY t1.nomMaterial
        `);
        return convertBigIntToNumber(results);
    })
    .get("/products/:idMaterial/composicao", async ({ params }) => {
        const idMaterial = Number(params.idMaterial);
        const results: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                m.idMaterial,
                m.nomMaterial,
                m.CodMaterial AS Codigo,
                cm.Quantidade
            FROM CRM_Produto_ComposicaoMaterial cm
            JOIN CRM_Produto_Material m ON cm.idMaterial = m.idMaterial
            WHERE cm.idComposicao = (
                SELECT TOP 1 idComposicao
                FROM CRM_Produto_ComposicaoMaterial
                WHERE idMaterial = ${idMaterial}
            )
            AND cm.idMaterial <> ${idMaterial}
        `);
        return convertBigIntToNumber(results);
    })
    .get("/product-detail/:propostaNo/:idMaterial", async ({ params }) => {
        const { propostaNo, idMaterial } = params;
        const results: any[] = await prisma.$queryRawUnsafe(
            `EXEC sp_CRMTabelaPrecoIndividual @PropostaNo = '${propostaNo}', @idMaterial = ${Number(idMaterial)}`
        );
        if (!results.length) return { error: "Produto não encontrado" };
        return convertBigIntToNumber(results[0]);
    })
    .get("/dropdowns", async () => {
        const [ufs, fretes, condicoes, outros]: any[] = await Promise.all([
            prisma.$queryRawUnsafe(`SELECT idDifal, UF FROM CRM_Proposta_Difal ORDER BY UF`),
            prisma.$queryRawUnsafe(`SELECT idFrete, Titulo AS Descricao FROM CRM_Proposta_Frete WHERE flaAtivo = 1 ORDER BY Titulo`),
            prisma.$queryRawUnsafe(`SELECT idCondicaoPagamento, Titulo AS Descricao FROM CRM_Proposta_CondicaoPagamento WHERE flaAtivo = 1 ORDER BY Titulo`),
            prisma.$queryRawUnsafe(`SELECT idOutros, Outros AS Descricao FROM CRM_Proposta_Outros WHERE flaAtivo = 1 ORDER BY Outros`),
        ]);
        return {
            ufs: convertBigIntToNumber(ufs),
            fretes: convertBigIntToNumber(fretes),
            condicoes: convertBigIntToNumber(condicoes),
            outros: convertBigIntToNumber(outros),
        };
    })
    .get("/etapas/:idProposta", async ({ params }) => {
        const id = Number(params.idProposta);
        const results: any[] = await prisma.$queryRawUnsafe(`
            SELECT idEtapa, Etapa, Descricao, Ordem FROM CRM_Proposta_Etapa WHERE idProposta = ${id} ORDER BY Ordem
        `);
        return convertBigIntToNumber(results);
    })
    .post("/etapas/:idProposta", async ({ params, body, set }) => {
        const id = Number(params.idProposta);
        const { Etapa, Descricao, Ordem } = body as any;
        const etapaName = String(Etapa || '').replace(/'/g, "''");
        const desc = String(Descricao || '').replace(/'/g, "''");
        const ordem = Number(Ordem || 0);
        try {
            const result: any[] = await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_Proposta_Etapa (idProposta, Etapa, Descricao, Ordem, dtaCadastro)
                OUTPUT INSERTED.idEtapa
                VALUES (${id}, '${etapaName}', '${desc}', ${ordem}, GETDATE())
            `);
            return convertBigIntToNumber(result[0]);
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao criar etapa" };
        }
    }, { params: t.Object({ idProposta: t.String() }) })
    .delete("/etapas/:idEtapa", async ({ params }) => {
        await prisma.$queryRawUnsafe(`DELETE FROM CRM_Proposta_Etapa WHERE idEtapa = ${Number(params.idEtapa)}`);
        return { success: true };
    }, { params: t.Object({ idEtapa: t.String() }) })
    .put("/:id", async ({ params, body }) => {
        const id = Number(params.id);
        const {
            idDifal, CalculaDifal, Desconto, idFrete, idCondicaoPagamento, Observacao, ObsChecagem,
            Possibilidade, GanhoEstimado, DataPossivel, dtaValidade, Area, ValorM2, FundoPobreza,
            idOutros, ValorOutros, Valor
        } = body as any;

        const sets: string[] = [];
        if (idDifal !== undefined) sets.push(`idDifal = ${Number(idDifal)}`);
        if (CalculaDifal !== undefined) sets.push(`CalculaDifal = ${Number(CalculaDifal)}`);
        if (Desconto !== undefined) sets.push(`Desconto = ${Number(Desconto)}`);
        if (idFrete !== undefined) sets.push(`idFrete = ${Number(idFrete)}`);
        if (idCondicaoPagamento !== undefined) sets.push(`idCondicaoPagamento = ${Number(idCondicaoPagamento)}`);
        if (Observacao !== undefined) sets.push(`Observacao = '${String(Observacao).replace(/'/g, "''")}'`);
        if (ObsChecagem !== undefined) sets.push(`ObsChecagem = '${String(ObsChecagem).replace(/'/g, "''")}'`);
        if (Possibilidade !== undefined) sets.push(`Possibilidade = ${Number(Possibilidade)}`);
        if (GanhoEstimado !== undefined) sets.push(`GanhoEstimado = ${Number(GanhoEstimado)}`);
        if (DataPossivel !== undefined) sets.push(`DataPossivel = '${DataPossivel}'`);
        if (dtaValidade !== undefined) sets.push(`dtaValidade = '${dtaValidade}'`);
        if (Area !== undefined) sets.push(`Area = ${Number(Area)}`);
        if (ValorM2 !== undefined) sets.push(`ValorM2 = ${Number(ValorM2)}`);
        if (FundoPobreza !== undefined) sets.push(`FundoPobreza = ${Number(FundoPobreza)}`);
        if (idOutros !== undefined) sets.push(`idOutros = ${Number(idOutros)}`);
        if (ValorOutros !== undefined) sets.push(`ValorOutros = ${Number(ValorOutros)}`);
        if (Valor !== undefined) sets.push(`Valor = ${Number(Valor)}`);

        if (!sets.length) return { error: "Nenhum campo para atualizar" };

        await prisma.$queryRawUnsafe(`UPDATE CRM_Proposta SET ${sets.join(", ")} WHERE idProposta = ${id}`);
        return { success: true };
    })
    .put("/:id/generate-code", async ({ params, body }) => {
        const id = Number(params.id);
        const { amostra } = body as any;
        const prop: any[] = await prisma.$queryRawUnsafe(
            `SELECT Desconto, idDifal FROM CRM_Proposta WHERE idProposta = ${id}`
        );
        if (!prop.length) return { error: "Proposta não encontrada" };
        const { Desconto, idDifal } = prop[0];

        let imposto = 0;
        if (idDifal) {
            const difal: any[] = await prisma.$queryRawUnsafe(
                `SELECT AliqEst FROM CRM_Proposta_Difal WHERE idDifal = ${Number(idDifal)}`
            );
            if (difal.length && difal[0].AliqEst) {
                imposto = Number(difal[0].AliqEst) * 100;
            }
        }

        const descontoPct = Math.round(Number(Desconto || 0) * 100);
        const amostraFlag = Number(amostra || 0);

        await prisma.$queryRawUnsafe(
            `EXEC sp_CRMGeraNoProposta @idProposta = ${id}, @Desconto = ${descontoPct}, @Imposto = '${imposto}', @Amostra = ${amostraFlag}`
        );
        // SP may not return rows in all drivers — fetch fresh value after execution
        const updated: any[] = await prisma.$queryRawUnsafe(
            `SELECT PropostaNo FROM CRM_Proposta WHERE idProposta = ${id}`
        );
        if (updated.length && updated[0].PropostaNo) {
            return { PropostaNo: updated[0].PropostaNo };
        }
        return { error: "Falha ao gerar código" };
    }, {
        body: t.Object({ amostra: t.Optional(t.Number()) })
    })
    // ── POST /condicoes-pagamento  — cadastrar nova condição ──────────────────
    .post("/condicoes-pagamento", async ({ body, set }) => {
        const { Titulo } = body as any;
        const titulo = String(Titulo || '').trim().replace(/'/g, "''");
        if (!titulo) { set.status = 400; return { error: "Informe o título" }; }
        try {
            const result: any[] = await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_Proposta_CondicaoPagamento (Titulo, flaAtivo)
                OUTPUT INSERTED.idCondicaoPagamento
                VALUES ('${titulo}', 1)
            `);
            return convertBigIntToNumber(result[0]);
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao criar condição de pagamento" };
        }
    })
    // ── GET composição de um material ────────────────────────────────────────────
    .get("/composition/:idMaterial", async ({ params }) => {
        const idMaterial = Number(params.idMaterial);

        // Busca idComposicao vinculado a este material
        const compLink: any[] = await prisma.$queryRawUnsafe(`
            SELECT TOP 1 cm.idComposicao, c.nomComposicao, c.PesoEmbalagem, c.PrecoKg, c.ValorEmbalagem
            FROM CRM_Produto_ComposicaoMaterial cm WITH (NOLOCK)
            JOIN CRM_Produto_Composicao c WITH (NOLOCK) ON cm.idComposicao = c.idComposicao
            WHERE cm.idMaterial = ${idMaterial}
        `);

        if (!compLink.length) return { hasComposition: false };

        const idComposicao = compLink[0].idComposicao;

        // Busca todos os materiais que compõem essa composição
        const materiais: any[] = await prisma.$queryRawUnsafe(`
            SELECT cm.idMaterial, m.nomMaterial, m.CodMaterial, m.PesoEmbalagem, m.PrecoKg, m.ValorEmbalagem, m.IPI
            FROM CRM_Produto_ComposicaoMaterial cm WITH (NOLOCK)
            JOIN CRM_Produto_Material m WITH (NOLOCK) ON cm.idMaterial = m.idMaterial
            WHERE cm.idComposicao = ${idComposicao}
            ORDER BY cm.id
        `);

        return convertBigIntToNumber({
            hasComposition: true,
            idComposicao,
            nomComposicao: compLink[0].nomComposicao,
            materiais,
        });
    })

    .post("/:id/items", async ({ params, body }) => {
        const id = Number(params.id);
        const { idMaterial, Quantidade, Desconto, MaterialDescricao, composicao, idEtapa } = body as any;

        if (composicao && composicao.idComposicao) {
            // Produto com composição: insere 1 pai (idMaterial=0) + N filhos
            const idComposicao = Number(composicao.idComposicao);
            const desc = String(MaterialDescricao || '').replace(/'/g, "''");

            // Registro pai
            await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_Proposta_Detalhe (idProposta, idMaterial, Quantidade, Desconto, MaterialDescricao, idEtapa, idComposicao, idComposicaoDetalhe, OrdemMaterial, OrdemComposicao, OrdemGrupo, OrdemEtapa)
                VALUES (${id}, 0, ${Number(Quantidade)}, ${Number(Desconto || 0)}, '${desc}', ${Number(idEtapa || 0)}, ${idComposicao}, 0, 0, 0, 0, 0)
            `);

            // Registros filhos (cada material da composição)
            for (const mat of composicao.materiais) {
                const matDesc = String(mat.nomMaterial || '').replace(/'/g, "''");
                await prisma.$queryRawUnsafe(`
                    INSERT INTO CRM_Proposta_Detalhe (idProposta, idMaterial, Quantidade, Desconto, MaterialDescricao, idEtapa, idComposicao, idComposicaoDetalhe, OrdemMaterial, OrdemComposicao, OrdemGrupo, OrdemEtapa)
                    VALUES (${id}, ${Number(mat.idMaterial)}, ${Number(Quantidade)}, ${Number(Desconto || 0)}, '${matDesc}', ${Number(idEtapa || 0)}, 0, ${idComposicao}, 0, 0, 0, 0)
                `);
            }
        } else {
            // Produto simples
            await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_Proposta_Detalhe (idProposta, idMaterial, Quantidade, Desconto, MaterialDescricao, idEtapa, idComposicao, idComposicaoDetalhe, OrdemMaterial, OrdemComposicao, OrdemGrupo, OrdemEtapa)
                VALUES (${id}, ${Number(idMaterial)}, ${Number(Quantidade)}, ${Number(Desconto || 0)}, '${String(MaterialDescricao || '').replace(/'/g, "''")}', ${Number(idEtapa || 0)}, 0, 0, 0, 0, 0, 0)
            `);
        }

        return { success: true };
    })
    // ── PATCH /:id/items/:itemId  — editar Quantidade / Desconto / ValorEmbalagem ──
    .patch("/:id/items/:itemId", async ({ params, body, set }) => {
        const itemId   = Number(params.itemId);
        const propId   = Number(params.id);
        const { Quantidade, Desconto, ValorEmbalagem, idEtapa } = body as any;

        const sets: string[] = [];
        if (Quantidade    !== undefined) sets.push(`Quantidade    = ${Number(Quantidade)}`);
        if (Desconto      !== undefined) sets.push(`Desconto      = ${Number(Desconto)}`);
        if (ValorEmbalagem !== undefined) sets.push(`ValorEmbalagem = ${Number(ValorEmbalagem)}`);
        if (idEtapa !== undefined) sets.push(`idEtapa = ${Number(idEtapa)}`);

        if (sets.length === 0) { set.status = 400; return { error: "Nenhum campo enviado" }; }

        try {
            // Atualiza o item solicitado
            await prisma.$queryRawUnsafe(
                `UPDATE CRM_Proposta_Detalhe SET ${sets.join(", ")} WHERE idPropostaDetalhe = ${itemId}`
            );

            // Se é item pai de composição (idMaterial=0), propaga Quantidade e Desconto para filhos
            const row: any[] = await prisma.$queryRawUnsafe(
                `SELECT idMaterial, idComposicao FROM CRM_Proposta_Detalhe WHERE idPropostaDetalhe = ${itemId}`
            );
            if (row.length && Number(row[0].idMaterial) === 0 && Number(row[0].idComposicao) > 0) {
                const childSets: string[] = [];
                if (Quantidade !== undefined) childSets.push(`Quantidade = ${Number(Quantidade)}`);
                if (Desconto   !== undefined) childSets.push(`Desconto   = ${Number(Desconto)}`);
                if (childSets.length) {
                    await prisma.$queryRawUnsafe(
                        `UPDATE CRM_Proposta_Detalhe SET ${childSets.join(", ")}
                         WHERE idComposicaoDetalhe = ${Number(row[0].idComposicao)} AND idProposta = ${propId}`
                    );
                }
            }
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao atualizar item" };
        }
    }, {
        params: t.Object({ id: t.String(), itemId: t.String() }),
    })

    .delete("/:id/items/:itemId", async ({ params }) => {
        const itemId = Number(params.itemId);
        // Verifica se o item é pai de composição (idMaterial=0, idComposicao>0)
        const row: any[] = await prisma.$queryRawUnsafe(
            `SELECT idMaterial, idComposicao FROM CRM_Proposta_Detalhe WHERE idPropostaDetalhe = ${itemId}`
        );
        if (row.length && Number(row[0].idMaterial) === 0 && Number(row[0].idComposicao) > 0) {
            // Apaga filhos primeiro
            await prisma.$queryRawUnsafe(
                `DELETE FROM CRM_Proposta_Detalhe WHERE idComposicaoDetalhe = ${Number(row[0].idComposicao)} AND idProposta = ${Number(params.id)}`
            );
        }
        await prisma.$queryRawUnsafe(`DELETE FROM CRM_Proposta_Detalhe WHERE idPropostaDetalhe = ${itemId}`);
        return { success: true };
    });
