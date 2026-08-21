import { prisma } from "../lib/prisma";
import { publicarTabelaPreco } from "../jobs/publicar-tabela-preco";

/**
 * Backfill único: repopula CRM_Produto_ComposicaoMaterial.PesoEmbalagem (recém-criado)
 * para os vínculos já existentes.
 *
 * A fonte de verdade do peso por composição é o staging de cada tabela de preço já
 * publicada (tbTabelaPrecoImport nunca é apagado após publicar). Em vez de tentar
 * reconstruir o peso "na mão" com SQL ad-hoc contra dados históricos ambíguos,
 * simplesmente republicamos TODAS as tabelas já publicadas, da mais antiga para a
 * mais recente — publicarTabelaPreco já é idempotente por chave natural
 * (CodMaterial/nomComposicao) e, com o fix desta correção, agora também grava
 * PesoEmbalagem no vínculo ao recriar CRM_Produto_ComposicaoMaterial. Processar em
 * ordem cronológica garante que, se duas tabelas publicadas tocaram a mesma
 * composição, a mais recente vence — igual ao comportamento normal de publicação.
 *
 * Rodar com: bun run src/scripts/backfill-peso-composicao.ts
 */
async function main() {
    const tabelas = await prisma.tbTabelaPreco.findMany({
        where: { Status: "Tabela Publicada" },
        orderBy: { id: "asc" },
    });

    if (tabelas.length === 0) {
        console.log("Nenhuma tabela de preço publicada encontrada. Nada para fazer.");
        return;
    }

    console.log(`${tabelas.length} tabela(s) publicada(s) encontrada(s). Republicando em ordem cronológica...`);

    for (const tabela of tabelas) {
        console.log(`\nRepublicando tabela de preço #${tabela.id} (${tabela.ArquivoNome ?? "sem nome"})...`);
        try {
            const resultado = await publicarTabelaPreco(tabela.id, (etapa, atual, total) => {
                if (atual % 50 === 0 || atual === total) {
                    console.log(`  ${etapa}: ${atual}/${total}`);
                }
            });
            console.log("  Concluído:", resultado);
        } catch (err) {
            console.error(`  Falha ao republicar tabela #${tabela.id}:`, err);
        }
    }
}

main()
    .catch(err => {
        console.error("Falha no backfill:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
