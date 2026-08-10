import { prisma } from "./prisma";

/**
 * Envia os itens de uma proposta aprovada (idStatus 3) para a tela de Produção,
 * inserindo em CRM_PedidosAbertos_ItemExtra (evita duplicidade via NOT EXISTS).
 */
export async function enviarPropostaParaProducao(idProposta: number, nomeUsuario: string = "") {
    const nome = nomeUsuario.replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`
        INSERT INTO CRM_PedidosAbertos_ItemExtra
            (idPropostaDetalhe, PropostaNo, dtaEnvio, nomComercial, NCM, CodMaterial, nomMaterial, codMaterialMatriz, Unidade, PesoEmbalagem, TTKG, TTCJ, Nome)
        SELECT
            d.idPropostaDetalhe,
            p.PropostaNo,
            GETDATE(),
            ISNULL(NULLIF(c.nomComercial, ''), c.nomContato),
            m.NCM,
            m.CodMaterial,
            ISNULL(NULLIF(d.MaterialDescricao, ''), m.nomMaterial),
            m.codMaterialMatriz,
            m.Unidade,
            CAST(ISNULL(m.PesoEmbalagem, 0) AS VARCHAR(50)),
            CAST(ISNULL(m.PesoEmbalagem, 0) * ISNULL(d.Quantidade, 0) AS VARCHAR(50)),
            CAST(ISNULL(d.Quantidade, 0) AS VARCHAR(50)),
            '${nome}'
        FROM CRM_Proposta_Detalhe d
        INNER JOIN CRM_Proposta p ON p.idProposta = d.idProposta
        LEFT JOIN CRM_Contato c ON c.idContato = p.idContato
        LEFT JOIN CRM_Produto_Material m ON m.idMaterial = d.idMaterial
        WHERE d.idProposta = ${idProposta}
            AND NOT EXISTS (
                SELECT 1 FROM CRM_PedidosAbertos_ItemExtra e
                WHERE e.idPropostaDetalhe = d.idPropostaDetalhe
            )
    `);
}
