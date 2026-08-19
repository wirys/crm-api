import { prisma } from "../lib/prisma";
import { registerJobType, startJobWorker } from "../lib/job-queue";
import { publicarTabelaPreco } from "./publicar-tabela-preco";
import { importarTabelaPreco } from "./importar-tabela-preco";

export const JOB_TABELA_PRECO_PUBLICAR = "TABELA_PRECO_PUBLICAR";
export const JOB_TABELA_PRECO_IMPORTAR = "TABELA_PRECO_IMPORTAR";

export function registerJobs() {
    registerJobType(JOB_TABELA_PRECO_IMPORTAR, {
        handler: async (idReferencia, payload) => {
            try {
                return await importarTabelaPreco(idReferencia, payload);
            } catch (err) {
                if (idReferencia) {
                    await prisma.tbTabelaPreco.update({
                        where: { id: idReferencia },
                        data: { Status: "Erro na Importação" },
                    }).catch((e) => console.error("Falha ao marcar status de erro na importação:", e));
                }
                throw err;
            }
        },
        maxTentativas: 2,
        circuitFailureThreshold: 3,
        circuitResetTimeoutMs: 60_000,
        retryBackoffMs: (tentativa) => Math.min(5_000 * 2 ** (tentativa - 1), 60_000),
    });

    registerJobType(JOB_TABELA_PRECO_PUBLICAR, {
        handler: async (idReferencia) => {
            try {
                const resultado = await publicarTabelaPreco(idReferencia);
                return resultado;
            } catch (err) {
                if (idReferencia) {
                    await prisma.tbTabelaPreco.update({
                        where: { id: idReferencia },
                        data: { Status: "Erro na Publicação" },
                    }).catch((e) => console.error("Falha ao marcar status de erro na publicação:", e));
                }
                throw err;
            }
        },
        maxTentativas: 3,
        circuitFailureThreshold: 3,
        circuitResetTimeoutMs: 60_000,
        retryBackoffMs: (tentativa) => Math.min(5_000 * 2 ** (tentativa - 1), 60_000),
    });

    startJobWorker();
}
