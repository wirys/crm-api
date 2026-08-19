import { prisma } from "../lib/prisma";

interface Celula {
    linha: number;
    coluna: number;
    valor: string;
}

/**
 * Importa os dados brutos (linha, coluna, valor) de uma planilha para a staging table
 * tbTabelaPrecoImport, escopado por idTabelaPreco. Roda em background (fora do ciclo
 * request/response) porque planilhas reais geram milhares de células — inserir tudo
 * de forma síncrona numa única transaction HTTP estourava o timeout padrão do Prisma
 * (5s) e disparava rollback, aparentando "erro zerando tudo".
 */
export async function importarTabelaPreco(idTabelaPreco: number | null, payload: { dados: Celula[] }) {
    if (!idTabelaPreco) {
        throw new Error("idTabelaPreco é obrigatório para importar a tabela de preço.");
    }
    const dados = payload?.dados;
    if (!dados || dados.length === 0) {
        throw new Error("Nenhum dado recebido para importação.");
    }

    await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DELETE FROM tbTabelaPrecoImport WHERE idTabelaPreco = ${idTabelaPreco}`);

        const BATCH_SIZE = 500;
        for (let i = 0; i < dados.length; i += BATCH_SIZE) {
            const batch = dados.slice(i, i + BATCH_SIZE);
            const values = batch
                .map(d => `SELECT ${idTabelaPreco}, ${d.linha}, ${d.coluna}, '${(d.valor ?? "").replace(/'/g, "''")}'`)
                .join(" UNION ALL ");
            await tx.$executeRawUnsafe(`
                INSERT INTO tbTabelaPrecoImport (idTabelaPreco, Linha, Coluna, Valor)
                ${values}
            `);
        }

        await tx.tbTabelaPreco.update({
            where: { id: idTabelaPreco },
            data: { Status: "Importado" },
        });
    }, { timeout: 300_000, maxWait: 15_000 });

    return { totalLinhas: dados.length };
}
