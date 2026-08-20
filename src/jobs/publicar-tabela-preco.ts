import { prisma } from "../lib/prisma";

/**
 * Reimplementação em TypeScript da antiga stored procedure `sp_CRMTabelaPrecoPublicar`.
 *
 * Diferenças deliberadas em relação à procedure legada (correção do bug relatado:
 * importação "zerando" itens e quebrando vínculo com propostas):
 *
 *  1. Escopada por `idTabelaPreco` — a procedure antiga lia TODA a tbTabelaPrecoImport,
 *     misturando publicações de tabelas diferentes.
 *  2. UPSERT por chave natural (CodMaterial / nomComposicao) em vez de
 *     "desativar tudo e inserir novo com ID novo" — preserva idMaterial/idComposicao
 *     já referenciados em CRM_Proposta_Detalhe, então propostas antigas não perdem
 *     o vínculo com o material/composição.
 *  3. Nunca desativa (`flaAtivo=0`) materiais que não fazem parte desta importação —
 *     a procedure antiga desativava a tabela inteira antes de reinserir.
 *  4. O staging (tbTabelaPrecoImport) nunca é tocado pela publicação — só é escrito
 *     na importação e lido (nunca alterado) na publicação/preview, então importar uma
 *     tabela nova não afeta o que já está publicado até o usuário clicar em "Publicar".
 *
 * O parsing de linha/coluna (o que é CABECALHO, GRUPO, COMPOSICAO, item de composição)
 * replica fielmente a lógica original para não alterar o resultado de negócio esperado.
 */

interface LinhaPivot {
    linha: number;
    col: Record<number, string>;
    tag: "" | "CABECALHO" | "COMPOSICAO" | "GRUPO" | "Item Composicao";
    idComposicaoImportacao: number | null;
}

export interface ProdutoStaging {
    linha: number;
    tag: LinhaPivot["tag"];
    idComposicaoImportacao: number | null;
    nomMaterial: string;
    NCM: string;
    CodMaterial: string;
    Unidade: string;
    ST: string;
    Consumo: string;
    Embalagem: string;
    PesoEmbalagem: number | null;
    IPI: number | null;
    PrecoKg07: number | null;
    PrecoKg12: number | null;
    PrecoKg18: number | null;
}

export interface ComposicaoStaging {
    nomComposicao: string;
    PesoEmbalagem: number | null;
    idComposicaoImportacao: number | null;
}

/**
 * Só troca vírgula por ponto — igual ao TRY_CAST(REPLACE(Col,',','.')) da procedure legada.
 * Os valores já chegam com ponto decimal (ex: "9.758837772397095", vindos de float do Excel),
 * então NÃO remover pontos como se fossem separador de milhar (isso corrompia os números,
 * ex: "1.32...99" virava "13299", causando overflow ao gravar em NUMERIC(18,4)).
 */
function toNumberSimple(valor: string | undefined | null): number | null {
    if (valor === undefined || valor === null) return null;
    const v = valor.trim();
    if (v === "") return null;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
}

function col(row: LinhaPivot, n: number): string {
    return (row.col[n] ?? "").trim();
}

/** Divide um array em lotes de tamanho `size`. */
function emLotes<T>(itens: T[], size: number): T[][] {
    const lotes: T[][] = [];
    for (let i = 0; i < itens.length; i += size) lotes.push(itens.slice(i, i + size));
    return lotes;
}

/**
 * Lê e classifica o staging (tbTabelaPrecoImport) de uma tabela de preço, sem escrever
 * nada — usado tanto pela publicação quanto pelo preview ("Visualizar Produtos"), que
 * funciona tanto para tabelas com status Importado quanto Publicado (o staging nunca é
 * apagado após a publicação).
 */
export async function parseStagingTabelaPreco(idTabelaPreco: number) {
    const staging = await prisma.tbTabelaPrecoImport.findMany({
        where: { idTabelaPreco },
    });

    if (staging.length === 0) {
        throw new Error(`Nenhum dado importado encontrado para a tabela de preço #${idTabelaPreco}.`);
    }

    // Pivotea (linha, coluna, valor) -> { linha, col1..col18 }, igual ao #t1 da procedure.
    //
    // O frontend (apps/crm/src/pages/tabela-preco.tsx) lê o xlsx com XLSX.utils.sheet_to_json
    // e grava Linha/Coluna 0-indexados (linha 0 = primeira linha da planilha, coluna 0 = coluna A).
    // Toda a lógica de classificação abaixo (herdada da procedure legada sp_CRMTabelaPrecoPublicar)
    // é 1-indexada (linha 1/2 = cabeçalho, coluna 2 = nome do produto, coluna 3 = NCM, ...).
    // Sem esse +1, cada valor cai numa coluna vizinha errada (nome vira NCM, NCM vira código, etc.),
    // o que corrompe a importação — provavelmente a causa raiz do "zera tudo" relatado.
    const porLinha = new Map<number, Record<number, string>>();
    for (const cell of staging) {
        if (cell.Linha == null || cell.Coluna == null) continue;
        const linha = cell.Linha + 1;
        const coluna = cell.Coluna + 1;
        if (!porLinha.has(linha)) porLinha.set(linha, {});
        porLinha.get(linha)![coluna] = cell.Valor ?? "";
    }

    let rows: LinhaPivot[] = Array.from(porLinha.entries())
        .map(([linha, colMap]) => ({ linha, col: colMap, tag: "" as LinhaPivot["tag"], idComposicaoImportacao: null }))
        .sort((a, b) => a.linha - b.linha);

    for (const r of rows) {
        if (r.linha === 1 || r.linha === 2) {
            r.tag = "CABECALHO";
        } else if (col(r, 16) === "0" && col(r, 17) === "0" && col(r, 18) === "0") {
            r.tag = "COMPOSICAO";
        } else if (
            col(r, 3) === "" && col(r, 4) === "" && col(r, 5) === "" && col(r, 7) === "" &&
            col(r, 8) === "" && col(r, 9) === "" && col(r, 10) === "" && col(r, 11) === "" &&
            col(r, 12) === "" && col(r, 14) === "" && col(r, 16) === "" && col(r, 17) === "" && col(r, 18) === ""
        ) {
            r.tag = "GRUPO";
        }
    }

    // Replica o cursor original (percorre de trás para frente marcando itens de composição).
    let emComposicao = false;
    let idComposicaoImportacao = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (emComposicao && r.tag === "") {
            r.tag = "Item Composicao";
            r.idComposicaoImportacao = idComposicaoImportacao;
        } else {
            emComposicao = false;
        }
        if (r.tag === "COMPOSICAO") {
            emComposicao = true;
            idComposicaoImportacao += 1;
            r.idComposicaoImportacao = idComposicaoImportacao;
        }
    }

    // Composições "reais" (linhas COMPOSICAO cujo nome contém CJ ou PRECO — mesmo filtro da procedure).
    const composicoesParaPublicar: ComposicaoStaging[] = rows
        .filter(r => r.tag === "COMPOSICAO" && /CJ|PRECO/i.test(col(r, 2)))
        .map(r => {
            const nome = col(r, 2);
            const idxCJ = nome.toUpperCase().indexOf("CJ");
            const idxPreco = nome.toUpperCase().indexOf("PRECO");
            const p1 = idxCJ >= 0 ? idxCJ : idxPreco;
            const bruto = p1 >= 0 ? nome.slice(p1) : "";
            const pesoStr = bruto
                .replace(/ /g, "")
                .replace(/CJ/gi, "")
                .replace(/PRECO/gi, "")
                .replace(/k/gi, "")
                .replace(/,/g, ".");
            const peso = pesoStr !== "" && Number.isFinite(Number(pesoStr)) ? Number(pesoStr) : null;
            return {
                nomComposicao: nome,
                PesoEmbalagem: peso,
                idComposicaoImportacao: r.idComposicaoImportacao,
            };
        });

    // Filtra as linhas que viram materiais (mesmos DELETEs da procedure original).
    const materiais: LinhaPivot[] = rows.filter(r => {
        if (r.linha === 1 || r.linha === 2) return false;
        if (col(r, 2) === "") return false;
        if (r.tag === "GRUPO") return false;
        if (r.tag === "COMPOSICAO") return false;
        if (col(r, 16) === "" && col(r, 17) === "" && col(r, 18) === "") return false;
        return true;
    });

    const produtos: ProdutoStaging[] = materiais.map(r => ({
        linha: r.linha,
        tag: r.tag,
        idComposicaoImportacao: r.idComposicaoImportacao,
        nomMaterial: col(r, 2),
        NCM: col(r, 3),
        CodMaterial: col(r, 4),
        Unidade: col(r, 9),
        ST: col(r, 11),
        Consumo: col(r, 6),
        Embalagem: col(r, 7),
        PesoEmbalagem: toNumberSimple(col(r, 14)),
        IPI: toNumberSimple(col(r, 10)),
        PrecoKg07: toNumberSimple(col(r, 16)),
        PrecoKg12: toNumberSimple(col(r, 17)),
        PrecoKg18: toNumberSimple(col(r, 18)),
    }));

    return { rows, materiais, composicoesParaPublicar, produtos, col };
}

export async function publicarTabelaPreco(
    idTabelaPreco: number | null,
    onProgress?: (etapa: string, atual: number, total: number) => void | Promise<void>
) {
    if (!idTabelaPreco) {
        throw new Error("idTabelaPreco é obrigatório para publicar a tabela de preço.");
    }

    const { materiais, composicoesParaPublicar } = await parseStagingTabelaPreco(idTabelaPreco);

    const resultado = { composicoesAtualizadas: 0, composicoesCriadas: 0, materiaisAtualizados: 0, materiaisCriados: 0, vinculosRecriados: 0 };

    // Pré-busca em lote (fora da transaction) o que já existe, para não fazer um
    // round-trip de leitura por linha dentro da transaction — com centenas de linhas
    // e latência de rede até o SQL Server remoto, isso facilmente estoura o timeout.
    const nomesComposicao = composicoesParaPublicar.map(c => c.nomComposicao);
    const codigosMaterial = materiais.map(r => col(r, 4)).filter(Boolean);
    const [composicoesExistentes, materiaisExistentes] = await Promise.all([
        nomesComposicao.length > 0
            ? prisma.cRM_Produto_Composicao.findMany({ where: { nomComposicao: { in: nomesComposicao } } })
            : Promise.resolve([]),
        codigosMaterial.length > 0
            ? prisma.cRM_Produto_Material.findMany({ where: { CodMaterial: { in: codigosMaterial } } })
            : Promise.resolve([]),
    ]);
    // CodMaterial/nomComposicao NÃO são únicos nos dados reais: anos de publicações pela
    // procedure legada (que sempre inseria novo em vez de atualizar) deixaram várias linhas
    // duplicadas para o mesmo código/nome, quase todas com flaAtivo=false. Para não escolher
    // uma duplicata aleatória, priorizamos: ativa > mais recentemente atualizada > maior id.
    const composicaoPorNome = new Map<string, (typeof composicoesExistentes)[number]>();
    for (const c of composicoesExistentes) {
        if (!c.nomComposicao) continue;
        const atual = composicaoPorNome.get(c.nomComposicao);
        if (!atual || c.idComposicao > atual.idComposicao) composicaoPorNome.set(c.nomComposicao, c);
    }
    const materialPorCodigo = new Map<string, (typeof materiaisExistentes)[number]>();
    for (const m of materiaisExistentes) {
        if (!m.CodMaterial) continue;
        const atual = materialPorCodigo.get(m.CodMaterial);
        if (!atual) { materialPorCodigo.set(m.CodMaterial, m); continue; }
        const melhor = (a: typeof m, b: typeof m) => {
            if (!!a.flaAtivo !== !!b.flaAtivo) return a.flaAtivo ? a : b;
            const da = a.dtaAtualizacao?.getTime() ?? 0;
            const db = b.dtaAtualizacao?.getTime() ?? 0;
            if (da !== db) return da > db ? a : b;
            return a.idMaterial > b.idMaterial ? a : b;
        };
        materialPorCodigo.set(m.CodMaterial, melhor(atual, m));
    }

    // Processamento em lotes com uma transaction curta por lote, em vez de uma única
    // transaction de até 5 minutos prendendo uma conexão do pool inteira. Cada lote é
    // idempotente (upsert por chave natural), então um retry do job (maxTentativas em
    // registry.ts) simplesmente reprocessa do início sem duplicar nada — os lotes já
    // publicados só recebem um update repetido.
    const LOTE_SIZE = 50;
    const totalPassos = composicoesParaPublicar.length + materiais.length;
    let passosFeitos = 0;

    // 1) Upsert de composições por chave natural (nomComposicao) — preserva idComposicao.
    const mapaIdComposicaoImportacaoParaIdComposicao = new Map<number, number>();
    const lotesComposicao = emLotes(composicoesParaPublicar, LOTE_SIZE);
    for (const lote of lotesComposicao) {
        await prisma.$transaction(async (tx) => {
            for (const c of lote) {
                const existente = composicaoPorNome.get(c.nomComposicao) ?? null;
                if (existente) {
                    await tx.cRM_Produto_Composicao.update({
                        where: { idComposicao: existente.idComposicao },
                        data: { PesoEmbalagem: c.PesoEmbalagem },
                    });
                    resultado.composicoesAtualizadas++;
                    if (c.idComposicaoImportacao != null) {
                        mapaIdComposicaoImportacaoParaIdComposicao.set(c.idComposicaoImportacao, existente.idComposicao);
                    }
                } else {
                    const criada = await tx.cRM_Produto_Composicao.create({
                        data: { nomComposicao: c.nomComposicao, PesoEmbalagem: c.PesoEmbalagem },
                    });
                    resultado.composicoesCriadas++;
                    if (c.idComposicaoImportacao != null) {
                        mapaIdComposicaoImportacaoParaIdComposicao.set(c.idComposicaoImportacao, criada.idComposicao);
                    }
                    // Composição nova recém-criada nesse mesmo publicarTabelaPreco: registra
                    // pra que outros lotes já enxerguem no map em memória.
                    composicaoPorNome.set(c.nomComposicao, criada);
                }
            }
        }, { timeout: 30_000, maxWait: 10_000 });
        passosFeitos += lote.length;
        await onProgress?.("Publicando composições", passosFeitos, totalPassos);
    }

    // 2) Upsert de materiais por chave natural (CodMaterial) — preserva idMaterial.
    const materiaisPublicados: { idMaterial: number; idComposicaoImportacao: number | null }[] = [];
    const lotesMaterial = emLotes(materiais, LOTE_SIZE);
    for (const lote of lotesMaterial) {
        await prisma.$transaction(async (tx) => {
            for (const r of lote) {
                const codMaterial = col(r, 4);
                const data = {
                    idMaterialGrupo: 43,
                    nomMaterial: col(r, 2),
                    codMaterialMatriz: codMaterial || null,
                    nomMaterialMatriz: col(r, 2),
                    NCM: col(r, 3) || null,
                    CodMaterial: codMaterial || null,
                    PesoEmbalagem: toNumberSimple(col(r, 14)),
                    Unidade: col(r, 9) || null,
                    ST: col(r, 11) || null,
                    flaComposicao: r.tag === "Item Composicao",
                    IPI: toNumberSimple(col(r, 10)),
                    PrecoKg18: toNumberSimple(col(r, 18)),
                    PrecoKg12: toNumberSimple(col(r, 17)),
                    PrecoKg07: toNumberSimple(col(r, 16)),
                    Embalagem: col(r, 7) || null,
                    Consumo: col(r, 6) || null,
                    dtaAtualizacao: new Date(),
                    flaAtivo: true,
                };

                const existente = codMaterial ? materialPorCodigo.get(codMaterial) ?? null : null;

                if (existente) {
                    await tx.cRM_Produto_Material.update({ where: { idMaterial: existente.idMaterial }, data });
                    resultado.materiaisAtualizados++;
                    materiaisPublicados.push({ idMaterial: existente.idMaterial, idComposicaoImportacao: r.idComposicaoImportacao });
                } else {
                    const criado = await tx.cRM_Produto_Material.create({ data });
                    resultado.materiaisCriados++;
                    materiaisPublicados.push({ idMaterial: criado.idMaterial, idComposicaoImportacao: r.idComposicaoImportacao });
                    if (codMaterial) materialPorCodigo.set(codMaterial, criado);
                }
            }
        }, { timeout: 30_000, maxWait: 10_000 });
        passosFeitos += lote.length;
        await onProgress?.("Publicando materiais", passosFeitos, totalPassos);
    }

    // 3) Recria os vínculos composição<->material só para as composições publicadas agora
    //    (não mexe em vínculos de composições que não fazem parte desta tabela de preço).
    const idsComposicaoTocadas = Array.from(mapaIdComposicaoImportacaoParaIdComposicao.values());
    if (idsComposicaoTocadas.length > 0) {
        await prisma.$transaction(async (tx) => {
            await tx.cRM_Produto_ComposicaoMaterial.deleteMany({
                where: { idComposicao: { in: idsComposicaoTocadas } },
            });
        }, { timeout: 30_000, maxWait: 10_000 });

        const vinculos = materiaisPublicados
            .filter(m => m.idComposicaoImportacao != null && mapaIdComposicaoImportacaoParaIdComposicao.has(m.idComposicaoImportacao))
            .map(m => ({
                idComposicao: mapaIdComposicaoImportacaoParaIdComposicao.get(m.idComposicaoImportacao!)!,
                idMaterial: m.idMaterial,
            }));

        for (const lote of emLotes(vinculos, 200)) {
            await prisma.cRM_Produto_ComposicaoMaterial.createMany({ data: lote });
            resultado.vinculosRecriados += lote.length;
        }
    }

    await onProgress?.("Finalizando", totalPassos, totalPassos);

    await prisma.tbTabelaPreco.update({
        where: { id: idTabelaPreco },
        data: { Status: "Tabela Publicada" },
    });

    return resultado;
}
