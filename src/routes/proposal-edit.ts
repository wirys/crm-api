import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function convertBigIntToNumber(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return Number(obj);
    if (obj instanceof Date) return obj.toISOString();
    if (typeof obj === 'object' && typeof obj.toNumber === 'function') return obj.toNumber();
    if (typeof obj === 'object') {
        if (Array.isArray(obj)) return obj.map(item => convertBigIntToNumber(item));
        const converted: any = {};
        for (const key of Object.keys(obj)) {
            converted[key] = convertBigIntToNumber(obj[key]);
        }
        return converted;
    }
    return obj;
}

const CHECAGEM_GROUPS = new Set([1, 2, 3, 4, 5, 7]);

async function checkProposalLocked(id: number, request: Request): Promise<string | null> {
    const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT idStatus FROM CRM_Proposta WHERE idProposta = ${id}`
    );
    if (!rows.length) return "Proposta não encontrada";
    const status = Number(rows[0].idStatus);

    // A partir de "Validado" (idStatus 3) a proposta é somente leitura para todos, sem exceção.
    if (status >= 3) return "Proposta já validada e não pode mais ser editada.";

    const userGroup = Number(request.headers.get("x-user-group") || 0);
    if (CHECAGEM_GROUPS.has(userGroup)) return null;

    if (status >= 2) return "Proposta em checagem. Apenas usuários com permissão de checagem podem editar.";
    return null;
}

export const proposalEditRoutes = new Elysia({ detail: { tags: ["Propostas"] }, prefix: "/proposal-edit" })
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
    }, {
        detail: {
            summary: "Buscar proposta para edição",
            description: "Retorna os dados completos de uma proposta pelo idProposta, incluindo UF, cliente, status e cor associados, para preencher o formulário de edição.",
        },
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
    }, {
        detail: {
            summary: "Buscar dados comerciais da proposta",
            description: "Retorna um resumo comercial da proposta (número, cliente, CNPJ, contato, frete, condição de pagamento, representante e observação de checagem), usado em telas de visualização/impressão da proposta.",
        },
    })
    .get("/:id/items", async ({ params }) => {
        const id = Number(params.id);

        // Fetch PropostaNo to use with sp_CRMTabelaPrecoIndividual
        const propRow: any[] = await prisma.$queryRawUnsafe(
            `SELECT PropostaNo FROM CRM_Proposta WHERE idProposta = ${id}`
        );
        const propostaNo: string = propRow[0]?.PropostaNo || "";

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
                CodMaterial     = ISNULL(t1.codMaterialAlt, ISNULL(t2.CodMaterial, '')),
                t2.NCM,
                PesoEmbalagem   = ISNULL(t1.PesoEmbalagemAlt, ISNULL(t2.PesoEmbalagem, 0)),
                PrecoKg         = ISNULL(t2.PrecoKg, 0),
                ValorEmbalagem  = ISNULL(t2.ValorEmbalagem, 0),
                IPI             = ISNULL(t2.IPI, 0),
                Unidade         = ISNULL(t2.Unidade, '')
            FROM CRM_Proposta_Detalhe AS t1
            LEFT OUTER JOIN CRM_Produto_Material AS t2 ON t1.idMaterial = t2.idMaterial AND t1.idMaterial > 0
            LEFT OUTER JOIN CRM_Proposta_Etapa AS e ON t1.idEtapa = e.idEtapa
            WHERE t1.idProposta = ${id}
            ORDER BY ISNULL(e.Ordem, 9999), t1.idComposicao, t1.idComposicaoDetalhe, t1.idPropostaDetalhe
        `);

        const converted = convertBigIntToNumber(results);

        // Enrich with real prices from sp_CRMTabelaPrecoIndividual when PropostaNo exists
        if (propostaNo) {
            const uniqueMaterials = [...new Set(
                converted.filter((r: any) => Number(r.idMaterial) > 0).map((r: any) => Number(r.idMaterial))
            )] as number[];

            if (uniqueMaterials.length > 0) {
                // Fetch prices in parallel
                const priceResults = await Promise.allSettled(
                    uniqueMaterials.map(idMat =>
                        prisma.$queryRawUnsafe(
                            `EXEC sp_CRMTabelaPrecoIndividual @PropostaNo = '${propostaNo}', @idMaterial = ${idMat}`
                        ).then((r: any) => ({ idMaterial: idMat, price: r[0] || null }))
                    )
                );

                const priceMap: Record<number, any> = {};
                for (const res of priceResults) {
                    if (res.status === "fulfilled" && res.value.price) {
                        priceMap[res.value.idMaterial] = convertBigIntToNumber(res.value.price);
                    }
                }

                // Apply prices to items
                for (const row of converted) {
                    const idMat = Number(row.idMaterial);
                    if (idMat > 0 && priceMap[idMat]) {
                        const p = priceMap[idMat];
                        row.ValorEmbalagem = Number(p.ValorEmbalagem ?? p.Valor ?? 0);
                        row.PrecoKg        = Number(p.PrecoKg ?? row.PrecoKg ?? 0);
                        row.PesoEmbalagem  = Number(p.PesoEmbalagem ?? row.PesoEmbalagem ?? 0);
                        row.IPI            = Number(p.IPI ?? row.IPI ?? 0);
                    }
                }
            }
        }

        return converted;
    }, {
        detail: {
            summary: "Listar itens da proposta",
            description: "Retorna os itens/materiais de uma proposta, ordenados por etapa e composição. Quando existe PropostaNo, enriquece cada item com preço, peso de embalagem e IPI reais buscados via sp_CRMTabelaPrecoIndividual.",
        },
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
    }, {
        detail: {
            summary: "Calcular totais da proposta",
            description: "Busca o PropostaNo da proposta e executa a stored procedure sp_CRMPropostaDetalhe para obter os totais calculados (quantidade, IPI, valor geral e peso), retornando lista vazia caso a proposta ainda não tenha PropostaNo.",
        },
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
    }, {
        detail: {
            summary: "Listar materiais ativos",
            description: "Retorna todos os materiais do catálogo (CRM_Produto_Material) com flaAtivo = 1, agrupados e ordenados por grupo de material, para uso em seletores de produtos.",
        },
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
    }, {
        detail: {
            summary: "Buscar materiais por texto",
            description: "Pesquisa até 50 materiais ativos cujo nome ou código contenham o termo informado no parâmetro de query `q`. Retorna lista vazia se `q` não for informado.",
        },
    })
    .get("/products/:idMaterial/composicao", async ({ params }) => {
        const idMaterial = Number(params.idMaterial);
        const results: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                m.idMaterial,
                m.nomMaterial,
                m.CodMaterial AS Codigo
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
    }, {
        detail: {
            summary: "Listar materiais de uma composição",
            description: "Dado um idMaterial, localiza a composição (CRM_Produto_ComposicaoMaterial) à qual ele pertence e retorna os demais materiais dessa mesma composição, excluindo o material informado.",
        },
    })
    .get("/product-detail/:propostaNo/:idMaterial", async ({ params }) => {
        const { propostaNo, idMaterial } = params;
        const results: any[] = await prisma.$queryRawUnsafe(
            `EXEC sp_CRMTabelaPrecoIndividual @PropostaNo = '${propostaNo}', @idMaterial = ${Number(idMaterial)}`
        );
        if (!results.length) return { error: "Produto não encontrado" };
        return convertBigIntToNumber(results[0]);
    }, {
        detail: {
            summary: "Buscar preço individual de um material",
            description: "Executa a stored procedure sp_CRMTabelaPrecoIndividual para um material específico dentro do contexto de uma proposta (propostaNo), retornando preço, peso de embalagem, IPI e valor de embalagem atualizados.",
        },
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
    }, {
        detail: {
            summary: "Listar opções para dropdowns da proposta",
            description: "Retorna em paralelo as listas ativas de UFs (Difal), fretes, condições de pagamento e outros encargos, usadas para popular os seletores do formulário de edição de proposta.",
        },
    })
    .get("/etapas/:idProposta", async ({ params }) => {
        const id = Number(params.idProposta);
        const results: any[] = await prisma.$queryRawUnsafe(`
            SELECT idEtapa, Etapa, Descricao, Ordem FROM CRM_Proposta_Etapa WHERE idProposta = ${id} ORDER BY Ordem
        `);
        return convertBigIntToNumber(results);
    }, {
        detail: {
            summary: "Listar etapas de uma proposta",
            description: "Retorna as etapas cadastradas (CRM_Proposta_Etapa) de uma proposta, ordenadas pelo campo Ordem, usadas para agrupar os itens da proposta em fases de produção.",
        },
    })
    .post("/etapas/:idProposta", async ({ params, body, set }) => {
        const id = Number(params.idProposta);
        const { Etapa, Descricao, Ordem } = body as any;
        const etapaName = String(Etapa || '').replace(/'/g, "''");
        const desc = String(Descricao || '').replace(/'/g, "''");
        let ordem = Ordem != null && Ordem !== 0 ? Number(Ordem) : null;
        if (ordem === null) {
            const maxResult: any[] = await prisma.$queryRawUnsafe(`
                SELECT ISNULL(MAX(Ordem), 0) as maxOrdem FROM CRM_Proposta_Etapa WHERE idProposta = ${id}
            `);
            ordem = Number(maxResult[0]?.maxOrdem ?? 0) + 1;
        }
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
    }, {
        params: t.Object({ idProposta: t.String() }),
        detail: {
            summary: "Criar etapa da proposta",
            description: "Cria uma nova etapa (CRM_Proposta_Etapa) para a proposta informada. Se Ordem não for enviada, calcula automaticamente a próxima posição com base no maior valor de Ordem já cadastrado.",
        },
    })
    .put("/etapas/:idEtapa", async ({ params, body, set }) => {
        const idEtapa = Number(params.idEtapa);
        const { Etapa, Descricao, Ordem } = body as any;
        const parts: string[] = [];
        if (Etapa !== undefined) parts.push(`Etapa = '${String(Etapa).replace(/'/g, "''")}'`);
        if (Descricao !== undefined) parts.push(`Descricao = '${String(Descricao).replace(/'/g, "''")}'`);
        if (Ordem !== undefined) parts.push(`Ordem = ${Number(Ordem)}`);
        if (parts.length === 0) return { success: true };
        try {
            await prisma.$executeRawUnsafe(`UPDATE CRM_Proposta_Etapa SET ${parts.join(', ')} WHERE idEtapa = ${idEtapa}`);
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao atualizar etapa" };
        }
    }, {
        params: t.Object({ idEtapa: t.String() }),
        detail: {
            summary: "Atualizar etapa",
            description: "Atualiza parcialmente os campos Etapa, Descricao e/ou Ordem de uma etapa existente, identificada por idEtapa. Apenas os campos enviados no body são alterados.",
        },
    })
    .put("/etapas-reorder/:idProposta", async ({ params, body, set }) => {
        const id = Number(params.idProposta);
        const { order } = body as any;
        if (!Array.isArray(order)) { set.status = 400; return { error: "order deve ser um array de idEtapa" }; }
        try {
            for (let i = 0; i < order.length; i++) {
                await prisma.$executeRawUnsafe(`UPDATE CRM_Proposta_Etapa SET Ordem = ${i + 1} WHERE idEtapa = ${Number(order[i])} AND idProposta = ${id}`);
            }
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao reordenar etapas" };
        }
    }, {
        params: t.Object({ idProposta: t.String() }),
        detail: {
            summary: "Reordenar etapas da proposta",
            description: "Recebe no body um array `order` com os idEtapa na nova sequência desejada e atualiza o campo Ordem de cada etapa (posição no array + 1) para a proposta informada.",
        },
    })
    .delete("/etapas/:idEtapa", async ({ params }) => {
        await prisma.$executeRawUnsafe(`DELETE FROM CRM_Proposta_Etapa WHERE idEtapa = ${Number(params.idEtapa)}`);
        return { success: true };
    }, {
        params: t.Object({ idEtapa: t.String() }),
        detail: {
            summary: "Excluir etapa",
            description: "Remove definitivamente uma etapa (CRM_Proposta_Etapa) pelo idEtapa informado.",
        },
    })
    .put("/:id", async ({ params, body, request, set }) => {
        const id = Number(params.id);
        const locked = await checkProposalLocked(id, request);
        if (locked) { set.status = 403; return { error: locked }; }
        const {
            idDifal, CalculaDifal, Desconto, idFrete, idCondicaoPagamento, Observacao, ObsChecagem,
            Possibilidade, GanhoEstimado, DataPossivel, dtaValidade, Area, ValorM2, FundoPobreza,
            idOutros, ValorOutros, Valor
        } = body as any;

        const sets: string[] = [];
        const num = (v: any) => (v === null || v === "" || v === undefined) ? "NULL" : String(Number(v));
        const str = (v: any) => (v === null || v === undefined) ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
        const date = (v: any) => (!v || v === "") ? "NULL" : `'${v}'`;

        if (idDifal !== undefined) sets.push(`idDifal = ${num(idDifal)}`);
        if (CalculaDifal !== undefined) sets.push(`CalculaDifal = ${num(CalculaDifal)}`);
        if (Desconto !== undefined) sets.push(`Desconto = ${num(Desconto)}`);
        if (idFrete !== undefined) sets.push(`idFrete = ${num(idFrete)}`);
        if (idCondicaoPagamento !== undefined) sets.push(`idCondicaoPagamento = ${num(idCondicaoPagamento)}`);
        if (Observacao !== undefined) sets.push(`Observacao = ${str(Observacao)}`);
        if (ObsChecagem !== undefined) sets.push(`ObsChecagem = ${str(ObsChecagem)}`);
        if (Possibilidade !== undefined) sets.push(`Possibilidade = ${num(Possibilidade)}`);
        if (GanhoEstimado !== undefined) sets.push(`GanhoEstimado = ${num(GanhoEstimado)}`);
        if (DataPossivel !== undefined) sets.push(`DataPossivel = ${date(DataPossivel)}`);
        if (dtaValidade !== undefined) sets.push(`dtaValidade = ${date(dtaValidade)}`);
        if (Area !== undefined) sets.push(`Area = ${num(Area)}`);
        if (ValorM2 !== undefined) sets.push(`ValorM2 = ${num(ValorM2)}`);
        if (FundoPobreza !== undefined) sets.push(`FundoPobreza = ${num(FundoPobreza)}`);
        if (idOutros !== undefined) sets.push(`idOutros = ${num(idOutros)}`);
        if (ValorOutros !== undefined) sets.push(`ValorOutros = ${num(ValorOutros)}`);
        if (Valor !== undefined) sets.push(`Valor = ${num(Valor)}`);

        if (!sets.length) return { error: "Nenhum campo para atualizar" };

        await prisma.$executeRawUnsafe(`UPDATE CRM_Proposta SET ${sets.join(", ")} WHERE idProposta = ${id}`);
        return { success: true };
    }, {
        detail: {
            summary: "Atualizar dados gerais da proposta",
            description: "Atualiza campos da proposta (Difal, desconto, frete, condição de pagamento, observações, possibilidade, ganho estimado, datas, área, valor por m², fundo de pobreza, outros e valor). Bloqueia a edição se a proposta estiver em checagem (idStatus >= 2) e o usuário não pertencer aos grupos com permissão de checagem.",
        },
    })
    .put("/:id/generate-code", async ({ params, body, request, set }) => {
        const id = Number(params.id);
        const locked = await checkProposalLocked(id, request);
        if (locked) { set.status = 403; return { error: locked }; }
        const {
            amostra,
            // Valores atuais do formulário — elimina race condition do debounce
            Desconto, idDifal, FundoPobreza, CalculaDifal,
            Possibilidade, GanhoEstimado, DataPossivel, dtaValidade,
            idCondicaoPagamento, idFrete,
        } = body as any;
        const amostraFlag = Number(amostra || 0);

        // ── 1. Força UPDATE com valores mais recentes do form (igual ao VBA) ──
        // Garante que o banco tem os dados corretos antes de chamar a SP,
        // mesmo que o debounce de 800ms ainda não tenha disparado.
        const preUpdateSets: string[] = [];
        if (Desconto          !== undefined) preUpdateSets.push(`Desconto = ${Number(Desconto)}`);
        if (idDifal           !== undefined) preUpdateSets.push(`idDifal = ${Number(idDifal)}`);
        if (FundoPobreza      !== undefined) preUpdateSets.push(`FundoPobreza = ${Number(FundoPobreza)}`);
        if (CalculaDifal      !== undefined) preUpdateSets.push(`CalculaDifal = ${Number(CalculaDifal)}`);
        if (Possibilidade     !== undefined) preUpdateSets.push(`Possibilidade = ${Number(Possibilidade)}`);
        if (GanhoEstimado     !== undefined) preUpdateSets.push(`GanhoEstimado = ${Number(GanhoEstimado)}`);
        if (DataPossivel      !== undefined && DataPossivel !== "") preUpdateSets.push(`DataPossivel = '${DataPossivel}'`);
        if (dtaValidade       !== undefined && dtaValidade !== "") preUpdateSets.push(`dtaValidade = '${dtaValidade}'`);
        if (idCondicaoPagamento !== undefined) preUpdateSets.push(`idCondicaoPagamento = ${Number(idCondicaoPagamento)}`);
        if (idFrete           !== undefined) preUpdateSets.push(`idFrete = ${Number(idFrete)}`);

        if (preUpdateSets.length > 0) {
            await prisma.$executeRawUnsafe(
                `UPDATE CRM_Proposta SET ${preUpdateSets.join(", ")} WHERE idProposta = ${id}`
            );
        }

        // ── 2. Lê imposto e desconto do banco (já atualizado) ─────────────────
        const propRaw: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                p.Desconto,
                p.FundoPobreza,
                p.CalculaDifal,
                p.Possibilidade,
                p.GanhoEstimado,
                p.DataPossivel,
                p.PropostaNo,
                imposto = ISNULL(d.AliqEst * 100, 0)
            FROM CRM_Proposta p
            LEFT JOIN CRM_Proposta_Difal d ON p.idDifal = d.idDifal
            WHERE p.idProposta = ${id}
        `);
        if (!propRaw.length) return { error: "Proposta não encontrada" };

        const row         = convertBigIntToNumber(propRaw[0]);
        const descontoPct = Math.round(Number(row.Desconto || 0) * 100);
        const impostoRaw  = Number(row.imposto || 0);
        const imposto     = Math.round(impostoRaw * 100) / 100;

        // ── 3. Chama SP (formato idêntico ao VBA) ────────────────────────────
        const extractCode = (spResult: any[]): string | null => {
            if (!spResult.length) return null;
            const r = convertBigIntToNumber(spResult[0]);
            const val = r.PropostaNo ?? r.propostano ?? r.Codigo ?? r.codigo
                ?? (Object.values(r)[0] as any);
            const s = String(val ?? "").trim();
            return s && s !== "null" && s !== "undefined" ? s : null;
        };

        let propostaNo: string | null = null;
        let lastError: any = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const spResult: any[] = await prisma.$queryRawUnsafe(
                    `EXEC sp_CRMGeraNoProposta @idProposta='${id}', @Desconto='${descontoPct}', @Imposto='${imposto}', @Amostra=${amostraFlag}`
                );
                propostaNo = extractCode(spResult);
                if (propostaNo) break;
            } catch (e) {
                lastError = e;
                console.error(`[generate-code] tentativa ${attempt} falhou:`, e);
                if (attempt < 3) await new Promise(r => setTimeout(r, 300 * attempt));
            }
        }

        // ── 4. Fallback: SELECT direto (caso SP tenha atualizado internamente) ─
        if (!propostaNo) {
            const sel: any[] = await prisma.$queryRawUnsafe(
                `SELECT PropostaNo FROM CRM_Proposta WHERE idProposta = ${id}`
            );
            const existing = sel[0]?.PropostaNo ? String(sel[0].PropostaNo).trim() : null;
            if (existing && existing !== "") propostaNo = existing;
        }

        if (!propostaNo) {
            console.error(`[generate-code] todas as tentativas falharam para idProposta=${id}`, lastError);
            return { error: "Não foi possível gerar o código. Tente novamente." };
        }

        // ── 5. 2º UPDATE (idêntico ao VBA — salva PropostaNo + campos do form)
        const descontoDb  = Number(row.Desconto || 0);
        const fpDb        = Number(row.FundoPobreza || 0);
        const difalDb     = Number(row.CalculaDifal || 0);
        const possibDb    = row.Possibilidade !== null && row.Possibilidade !== undefined ? Number(row.Possibilidade) : "Null";
        const ganhoDb     = row.GanhoEstimado !== null && row.GanhoEstimado !== undefined ? Number(row.GanhoEstimado) : "Null";
        const dataPosDb   = row.DataPossivel || "";

        await prisma.$executeRawUnsafe(
            `UPDATE CRM_Proposta SET ` +
            `FundoPobreza=${fpDb}, ` +
            `PropostaNo='${String(propostaNo).replace(/'/g, "''")}', ` +
            `Desconto=${descontoDb}, ` +
            `CalculaDifal=${difalDb}, ` +
            `Possibilidade=${possibDb}, ` +
            `GanhoEstimado=${ganhoDb}, ` +
            `DataPossivel='${dataPosDb}' ` +
            `WHERE idProposta='${id}'`
        );

        // SP auxiliar para amostras
        if (amostraFlag === 1 && dataPosDb) {
            try {
                await prisma.$queryRawUnsafe(
                    `EXEC CRM_AMOContatoUpdate @idProposta=${id}, @dta='${dataPosDb}', @idUsuario=0`
                );
            } catch { /* não bloqueia o fluxo principal */ }
        }

        return { PropostaNo: propostaNo };
    }, {
        body: t.Object({
            amostra: t.Optional(t.Number()),
            Desconto: t.Optional(t.Number()),
            idDifal: t.Optional(t.Number()),
            FundoPobreza: t.Optional(t.Number()),
            CalculaDifal: t.Optional(t.Number()),
            Possibilidade: t.Optional(t.Number()),
            GanhoEstimado: t.Optional(t.Number()),
            DataPossivel: t.Optional(t.String()),
            dtaValidade: t.Optional(t.String()),
            idCondicaoPagamento: t.Optional(t.Number()),
            idFrete: t.Optional(t.Number()),
        }),
        detail: {
            summary: "Gerar código (PropostaNo) da proposta",
            description: "Grava os valores mais recentes do formulário antes de chamar a stored procedure sp_CRMGeraNoProposta (com até 3 tentativas) para gerar o PropostaNo definitivo, salva o código gerado de volta na proposta e, se for amostra com data possível definida, dispara a SP CRM_AMOContatoUpdate. Bloqueia a edição se a proposta estiver em checagem e o usuário não tiver permissão.",
        },
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
    }, {
        detail: {
            summary: "Criar condição de pagamento",
            description: "Cadastra uma nova condição de pagamento (CRM_Proposta_CondicaoPagamento) ativa, a partir do título informado no body.",
        },
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
    }, {
        detail: {
            summary: "Buscar composição de um material",
            description: "Verifica se o material informado pertence a uma composição (bicomponente, tricomponente etc.) e, em caso positivo, retorna todos os materiais que integram essa composição com seus dados de preço e peso.",
        },
    })

    .post("/:id/items", async ({ params, body, request, set }) => {
        const id = Number(params.id);
        const locked = await checkProposalLocked(id, request);
        if (locked) { set.status = 403; return { error: locked }; }
        const { idMaterial, Quantidade, Desconto, MaterialDescricao, composicao, idEtapa } = body as any;

        if (composicao && composicao.idComposicao) {
            const idComposicao = Number(composicao.idComposicao);
            const etapa = Number(idEtapa || 0);
            const qtd = Number(Quantidade);

            // Get next idComposicaoDetalhe (same as old CRM)
            const maxRes: any[] = await prisma.$queryRawUnsafe(
                `SELECT idComposicaoDetalhe = ISNULL(MAX(idComposicaoDetalhe), 0) FROM CRM_Proposta_Detalhe WHERE idProposta = ${id} AND idComposicao = ${idComposicao}`
            );
            const nextCompDetalhe = Number(maxRes[0]?.idComposicaoDetalhe ?? 0) + 1;

            // Fetch composition materials from catalog
            const compMats: any[] = await prisma.$queryRawUnsafe(
                `SELECT idMaterial FROM CRM_Produto_ComposicaoMaterial WHERE idComposicao = ${idComposicao}`
            );

            for (const mat of compMats) {
                const matId = Number(mat.idMaterial);
                await prisma.$queryRawUnsafe(`
                    INSERT INTO CRM_Proposta_Detalhe (idComposicaoDetalhe, idEtapa, idComposicao, idProposta, idMaterial, Quantidade, Desconto)
                    VALUES (${nextCompDetalhe}, ${etapa}, ${idComposicao}, ${id}, ${matId}, ${qtd}, NULL)
                `);
            }
        } else {
            const etapa = Number(idEtapa || 0);
            await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_Proposta_Detalhe (idEtapa, idComposicao, idProposta, idMaterial, Quantidade, Desconto)
                VALUES (${etapa}, NULL, ${id}, ${Number(idMaterial)}, ${Number(Quantidade)}, NULL)
            `);
        }

        return { success: true };
    }, {
        detail: {
            summary: "Adicionar item à proposta",
            description: "Insere um novo item em CRM_Proposta_Detalhe. Se o body contiver `composicao.idComposicao`, replica o item para todos os materiais dessa composição usando o mesmo idComposicaoDetalhe; caso contrário insere um item avulso com o idMaterial informado. Bloqueia a operação se a proposta estiver em checagem.",
        },
    })
    // ── PATCH /:id/items/:itemId  — editar Quantidade / Desconto ──
    .patch("/:id/items/:itemId", async ({ params, body, set, request }) => {
        const itemId   = Number(params.itemId);
        const propId   = Number(params.id);
        const locked = await checkProposalLocked(propId, request);
        if (locked) { set.status = 403; return { error: locked }; }
        const { Quantidade, Desconto, idEtapa } = body as any;

        const sets: string[] = [];
        if (Quantidade    !== undefined) sets.push(`Quantidade    = ${Number(Quantidade)}`);
        if (Desconto      !== undefined) sets.push(`Desconto      = ${Number(Desconto)}`);
        if (idEtapa !== undefined) sets.push(`idEtapa = ${Number(idEtapa)}`);

        if (sets.length === 0) { set.status = 400; return { error: "Nenhum campo enviado" }; }

        try {
            // Atualiza o item solicitado
            await prisma.$executeRawUnsafe(
                `UPDATE CRM_Proposta_Detalhe SET ${sets.join(", ")} WHERE idPropostaDetalhe = ${itemId}`
            );

            // Se é item de composição (bicomponente, tricomponente, etc), propaga Quantidade e Desconto para os demais materiais do mesmo grupo
            const row: any[] = await prisma.$queryRawUnsafe(
                `SELECT idComposicao, idComposicaoDetalhe FROM CRM_Proposta_Detalhe WHERE idPropostaDetalhe = ${itemId}`
            );
            if (row.length && Number(row[0].idComposicao) > 0) {
                const childSets: string[] = [];
                if (Quantidade !== undefined) childSets.push(`Quantidade = ${Number(Quantidade)}`);
                if (Desconto   !== undefined) childSets.push(`Desconto   = ${Number(Desconto)}`);
                if (childSets.length) {
                    await prisma.$executeRawUnsafe(
                        `UPDATE CRM_Proposta_Detalhe SET ${childSets.join(", ")}
                         WHERE idComposicao = ${Number(row[0].idComposicao)}
                           AND idComposicaoDetalhe = ${Number(row[0].idComposicaoDetalhe)}
                           AND idProposta = ${propId}
                           AND idPropostaDetalhe <> ${itemId}`
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
        detail: {
            summary: "Editar item da proposta",
            description: "Atualiza Quantidade, Desconto e/ou idEtapa de um item (idPropostaDetalhe). Se o item pertencer a uma composição, propaga Quantidade e Desconto para os demais materiais do mesmo grupo de composição. Bloqueia a edição se a proposta estiver em checagem.",
        },
    })

    .delete("/:id/items/:itemId", async ({ params, request, set }) => {
        const itemId = Number(params.itemId);
        const propId = Number(params.id);
        const locked = await checkProposalLocked(propId, request);
        if (locked) { set.status = 403; return { error: locked }; }
        // Verifica se o item é pai de composição (idMaterial=0, idComposicao>0)
        const row: any[] = await prisma.$queryRawUnsafe(
            `SELECT idMaterial, idComposicao FROM CRM_Proposta_Detalhe WHERE idPropostaDetalhe = ${itemId}`
        );
        if (row.length && Number(row[0].idMaterial) === 0 && Number(row[0].idComposicao) > 0) {
            // Apaga filhos primeiro
            await prisma.$executeRawUnsafe(
                `DELETE FROM CRM_Proposta_Detalhe WHERE idComposicaoDetalhe = ${Number(row[0].idComposicao)} AND idProposta = ${Number(params.id)}`
            );
        }
        await prisma.$executeRawUnsafe(`DELETE FROM CRM_Proposta_Detalhe WHERE idPropostaDetalhe = ${itemId}`);
        return { success: true };
    }, {
        detail: {
            summary: "Excluir item da proposta",
            description: "Remove um item (idPropostaDetalhe) de CRM_Proposta_Detalhe. Se o item for pai de uma composição (idMaterial = 0 e idComposicao > 0), exclui primeiro os itens filhos dessa composição. Bloqueia a exclusão se a proposta estiver em checagem.",
        },
    })
    .get("/:id/detalhe", async ({ params }) => {
        const id = Number(params.id);
        const prop: any[] = await prisma.$queryRawUnsafe(
            `SELECT PropostaNo FROM CRM_Proposta WHERE idProposta = ${id}`
        );
        if (!prop.length || !prop[0].PropostaNo) return { rows: [], summary: null };
        const propostaNo = prop[0].PropostaNo;

        const results: any[] = await prisma.$queryRawUnsafe(
            `EXEC sp_CRMPropostaDetalhe @PropostaNo = '${propostaNo}'`
        );
        const rows = convertBigIntToNumber(results);
        if (!rows.length) return { rows: [], summary: null };

        const last = rows[rows.length - 1];
        const summary = {
            TotalQuantidade: Number(last.TotalQuantidade ?? 0),
            TotalIPIValor: Number(last.TotalIPIValor ?? 0),
            TotalGeral: Number(last.TotalGeral ?? 0),
            TotalKgGeral: Number(last.TotalKgGeral ?? 0),
            ValorFrete: Number(last.Valor ?? 0),
            ValorOutros: Number(last.ValorOutros ?? 0),
            idOutros: Number(last.idOutros ?? 0),
            Outros: last.Outros || "",
        };

        return { rows, summary };
    }, {
        detail: {
            summary: "Buscar detalhamento e resumo da proposta",
            description: "Executa a stored procedure sp_CRMPropostaDetalhe para o PropostaNo da proposta e retorna as linhas de detalhamento junto com um resumo consolidado (quantidade total, IPI total, valor geral, peso total, frete e outros), extraído da última linha retornada pela SP.",
        },
    })
    .patch("/:id/items/bulk-discount", async ({ params, body, request, set }) => {
        const propId = Number(params.id);
        const locked = await checkProposalLocked(propId, request);
        if (locked) { set.status = 403; return { error: locked }; }
        const { desconto, mode } = body as { desconto: number; mode: "all" | "non-manual" };

        if (mode === "all") {
            await prisma.$executeRawUnsafe(
                `UPDATE CRM_Proposta_Detalhe SET Desconto = ${Number(desconto)} WHERE idProposta = ${propId}`
            );
        } else if (mode === "non-manual") {
            await prisma.$executeRawUnsafe(
                `UPDATE CRM_Proposta_Detalhe SET Desconto = ${Number(desconto)} WHERE idProposta = ${propId} AND Desconto IS NULL`
            );
        }
        return { success: true };
    }, {
        params: t.Object({ id: t.String() }),
        detail: {
            summary: "Aplicar desconto em massa aos itens",
            description: "Aplica o percentual de desconto informado a todos os itens da proposta (mode = 'all') ou apenas aos itens sem desconto manual definido (mode = 'non-manual'), atualizando CRM_Proposta_Detalhe. Bloqueia a operação se a proposta estiver em checagem.",
        },
    })
    .get("/:id/items/has-manual-discount", async ({ params }) => {
        const propId = Number(params.id);
        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*) as cnt FROM CRM_Proposta_Detalhe WHERE idProposta = ${propId} AND Desconto IS NOT NULL`
        );
        return { hasManual: Number(rows[0]?.cnt ?? 0) > 0 };
    }, {
        detail: {
            summary: "Verificar se há desconto manual nos itens",
            description: "Verifica se a proposta possui ao menos um item (CRM_Proposta_Detalhe) com desconto definido manualmente (campo Desconto não nulo), usado para alertar antes de aplicar desconto em massa.",
        },
    })
    .patch("/:id/detalhe/material", async ({ params, body, request, set }) => {
        const propId = Number(params.id);
        const locked = await checkProposalLocked(propId, request);
        if (locked) { set.status = 403; return { error: locked }; }
        const { idPropostaDetalhe, field, value } = body as any;
        const id = Number(idPropostaDetalhe);
        const columnMap: Record<string, string> = {
            CodMaterial: "codMaterialAlt",
            PesoEmbalagem: "PesoEmbalagemAlt",
            MaterialDescricao: "MaterialDescricao",
        };
        if (!(field in columnMap)) return { error: "Campo não permitido" };

        const safeVal = field === "PesoEmbalagem"
            ? Number(value)
            : `'${String(value).replace(/'/g, "''")}'`;
        const col = columnMap[field];
        try {
            await prisma.$executeRawUnsafe(
                `UPDATE CRM_Proposta_Detalhe SET ${col} = ${safeVal} WHERE idPropostaDetalhe = ${id}`
            );
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao atualizar material" };
        }
    }, {
        detail: {
            summary: "Editar campo alternativo do material do item",
            description: "Atualiza um único campo alternativo de um item da proposta (CodMaterial -> codMaterialAlt, PesoEmbalagem -> PesoEmbalagemAlt ou MaterialDescricao), identificado por idPropostaDetalhe. Rejeita campos fora da lista permitida. Bloqueia a edição se a proposta estiver em checagem.",
        },
    });
