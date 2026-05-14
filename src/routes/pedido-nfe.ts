import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function convertBigIntToNumber(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return Number(obj);
    if (obj instanceof Date) return obj;
    if (typeof obj === 'object') {
        if (Array.isArray(obj)) return obj.map(item => convertBigIntToNumber(item));
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

export const pedidoNfeRoutes = new Elysia({ prefix: "/pedido-nfe" })
    // Lista pedidos concluídos com filtros
    .get("/", async ({ query }) => {
        const {
            propostaNo,
            search,
            dtaInicio,
            dtaFim,
            nomComercial,
            representante,
            page = 1,
            limit = 50
        } = query as any;

        const skip = (Number(page) - 1) * Number(limit);

        try {
            // Buscar propostas concluídas (idStatus 4 ou 5)
            const wherePropostas: any = {
                idStatus: { in: [4, 5] }
            };

            if (propostaNo) {
                wherePropostas.PropostaNo = { contains: propostaNo };
            }

            if (search) {
                wherePropostas.OR = [
                    { PropostaNo: { contains: search } },
                ];
            }

            if (dtaInicio && dtaFim) {
                wherePropostas.dtaCriacao = {
                    gte: new Date(dtaInicio),
                    lte: new Date(dtaFim)
                };
            }

            // Buscar propostas
            const propostas = await prisma.cRM_Proposta.findMany({
                where: wherePropostas,
                select: {
                    idProposta: true,
                    PropostaNo: true,
                    dtaCriacao: true,
                    idContato: true,
                    idUsuario: true
                },
                orderBy: { idProposta: 'desc' },
                skip,
                take: Number(limit)
            });

            const total = await prisma.cRM_Proposta.count({ where: wherePropostas });

            // Buscar dados relacionados
            const propostaIds = propostas.map(p => p.idProposta);
            const contatoIds = [...new Set(propostas.map(p => p.idContato).filter(Boolean))] as number[];
            const usuarioIds = [...new Set(propostas.map(p => p.idUsuario).filter(Boolean))] as number[];

            // Buscar detalhes das propostas
            const detalhes = await prisma.cRM_Proposta_Detalhe.findMany({
                where: { idProposta: { in: propostaIds } },
                select: {
                    idPropostaDetalhe: true,
                    idProposta: true,
                    idMaterial: true,
                    Quantidade: true,
                    MaterialDescricao: true,
                    dtaEnvio: true
                }
            });

            // Buscar contatos
            const contatos = contatoIds.length > 0 ? await prisma.cRM_Contato.findMany({
                where: { idContato: { in: contatoIds } },
                select: { idContato: true, nomComercial: true }
            }) : [];

            // Buscar usuários/representantes
            const usuarios = usuarioIds.length > 0 ? await prisma.cRM_Usuario.findMany({
                where: { idUsuario: { in: usuarioIds } },
                select: { idUsuario: true, Nome: true }
            }) : [];

            // Buscar materiais
            const materialIds = [...new Set(detalhes.map(d => d.idMaterial).filter(Boolean))] as number[];
            const materiais = materialIds.length > 0 ? await prisma.cRM_Produto_Material.findMany({
                where: { idMaterial: { in: materialIds } },
                select: { idMaterial: true, CodMaterial: true, nomMaterial: true, Unidade: true, PesoEmbalagem: true }
            }) : [];

            // Mapear dados
            const contatoMap = new Map(contatos.map(c => [c.idContato, c]));
            const usuarioMap = new Map(usuarios.map(u => [u.idUsuario, u]));
            const materialMap = new Map(materiais.map(m => [m.idMaterial, m]));
            const propostaMap = new Map(propostas.map(p => [p.idProposta, p]));

            // Formatar items
            const formattedItems = detalhes.map(detalhe => {
                const proposta = propostaMap.get(detalhe.idProposta || 0);
                const contato = proposta?.idContato ? contatoMap.get(proposta.idContato) : null;
                const usuario = proposta?.idUsuario ? usuarioMap.get(proposta.idUsuario) : null;
                const material = detalhe.idMaterial ? materialMap.get(detalhe.idMaterial) : null;

                return {
                    idPropostaDetalhe: detalhe.idPropostaDetalhe,
                    idProposta: detalhe.idProposta,
                    PropostaNo: proposta?.PropostaNo || '',
                    dtaEnvio: detalhe.dtaEnvio || proposta?.dtaCriacao,
                    nomComercial: contato?.nomComercial || '',
                    codMaterial: material?.CodMaterial || '',
                    nomMaterial: material?.nomMaterial || detalhe.MaterialDescricao || '',
                    Unidade: material?.Unidade || '',
                    Quantidade: detalhe.Quantidade,
                    PesoEmbalagem: material?.PesoEmbalagem || 0,
                    representante: usuario?.Nome || '',
                    // Status padrão (sem relações de status no schema atual)
                    Financeiro_Status: 'Concluído',
                    Financeiro_Cor: '#28a745',
                    Estoque_Status: 'Concluído',
                    Estoque_Cor: '#28a745',
                    Producao_Status: 'Concluído',
                    Producao_Cor: '#28a745',
                    Expedicao_Status: 'Concluído',
                    Expedicao_Cor: '#28a745',
                    // Campos para NFe (não existem no schema atual)
                    xmlNfe: null,
                    chaveNfe: null,
                    numeroNfe: null,
                    dtaEmissaoNfe: null
                };
            });

            return convertBigIntToNumber({
                data: formattedItems,
                meta: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    hasMore: skip + formattedItems.length < total
                }
            });
        } catch (error: any) {
            console.error('Erro ao buscar pedidos:', error);
            return {
                data: [],
                meta: { page: 1, limit: 50, total: 0, hasMore: false },
                error: error?.message || 'Erro ao buscar pedidos'
            };
        }
    })

    // Upload e associação de XML da NFe (desabilitado - campos não existem no schema)
    .post("/upload-xml/:idPropostaDetalhe", async ({ params, body }) => {
        return {
            success: false,
            error: "Funcionalidade de upload de NFe não disponível. Os campos xmlNfe, chaveNfe, numeroNfe precisam ser adicionados ao schema."
        };
    }, {
        body: t.Object({
            xmlContent: t.String(),
            chaveNfe: t.Optional(t.String()),
            numeroNfe: t.Optional(t.String())
        })
    })

    // Obter XML da NFe associada a um pedido (desabilitado - campos não existem no schema)
    .get("/xml/:idPropostaDetalhe", async ({ params }) => {
        return { error: "Funcionalidade de XML de NFe não disponível. Os campos precisam ser adicionados ao schema." };
    })

    // Filtros auxiliares
    .get("/filtros/propostas", async () => {
        const propostas = await prisma.cRM_Proposta.findMany({
            where: {
                PropostaNo: { not: null }
            },
            select: {
                idProposta: true,
                PropostaNo: true
            },
            orderBy: { PropostaNo: 'asc' },
            take: 1000
        });
        return convertBigIntToNumber(propostas);
    })

    .get("/filtros/contatos", async () => {
        const contatos = await prisma.cRM_Contato.findMany({
            select: {
                idContato: true,
                nomComercial: true,
                CNPJ: true
            },
            orderBy: { nomComercial: 'asc' },
            take: 1000
        });
        return convertBigIntToNumber(contatos);
    })

    .get("/filtros/produtos", async () => {
        const produtos = await prisma.cRM_Produto_Material.findMany({
            where: {
                CodMaterial: { notIn: ['', '???'] }
            },
            select: {
                CodMaterial: true,
                nomMaterial: true,
                Unidade: true
            },
            distinct: ['CodMaterial'],
            orderBy: { CodMaterial: 'asc' },
            take: 1000
        });
        return convertBigIntToNumber(produtos);
    })

    .get("/filtros/representantes", async () => {
        const representantes = await prisma.cRM_Usuario.findMany({
            select: {
                idUsuario: true,
                Nome: true
            },
            orderBy: { Nome: 'asc' },
            take: 100
        });
        return convertBigIntToNumber(representantes);
    });
