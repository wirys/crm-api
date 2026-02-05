import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

export const contactsRoutes = new Elysia({ prefix: "/contacts" })
    .get("/segments", async () => {
        return await prisma.cRM_SegmentoAtuacao.findMany({
            select: {
                id: true,
                Cod: true,
                SegmentoAtuacao: true,
            },
            orderBy: { Cod: "asc" },
        });
    })
    .get("/origins", async () => {
        return await prisma.cRM_Origem.findMany({
            select: {
                idOrigem: true,
                Origem: true,
                corHTML: true,
            },
            orderBy: { Origem: "asc" },
        });
    })
    .get("/representatives", async () => {
        return await prisma.cRM_Usuario.findMany({
            select: {
                idUsuario: true,
                Nome: true,
            },
            orderBy: { Nome: "asc" },
        });
    })
    .get("/", async ({ query }) => {
        const { representatives } = query;

        let where: any = {};

        if (representatives) {
            const repIds = representatives.split(",").map(id => parseInt(id)).filter(id => !isNaN(id));
            if (repIds.length > 0) {
                where = {
                    OR: [
                        { idRepresentante: { in: repIds } },
                        // In the future, we might need to check adicionales too, 
                        // but for now let's stick to the primary representative to match VB basic logic
                    ]
                };
            }
        }

        const now = new Date();

        const contactsList = await prisma.cRM_Contato.findMany({
            where,
            include: {
                status: true,
                origem: true,
                representante: {
                    select: {
                        idUsuario: true,
                        Nome: true,
                        Email: true,
                    }
                },
                representantesAdicionais: {
                    include: {
                        representante: {
                            select: {
                                Nome: true
                            }
                        }
                    }
                },
                _count: {
                    select: {
                        propostas: true,
                        agenda: true // Using agenda as a proxy for interactions
                    }
                },
                agenda: {
                    where: {
                        DataInicio: {
                            gte: now
                        }
                    },
                    orderBy: {
                        DataInicio: "asc"
                    },
                    take: 1
                }
            },
            orderBy: { dtaCadastro: "desc" },
            take: 200,
        });

        // Flatten some data for easier consumption in frontend
        return contactsList.map(c => ({
            ...c,
            intProposta: c._count.propostas,
            interactionCount: c._count.agenda,
            proximaAtividade: c.agenda[0]?.DataInicio || null,
            representantesAdicionais: c.representantesAdicionais.map(ra => ra.representante?.Nome).filter(Boolean)
        }));
    })
    .post(
        "/",
        async ({ body, set }) => {
            try {
                const { contact, address } = body;

                // Check for existing CPF/CNPJ
                if (contact.TipoPessoa === "0" && contact.CPF) {
                    const exists = await prisma.cRM_Contato.count({
                        where: { CPF: contact.CPF },
                    });
                    if (exists > 0) {
                        set.status = 400;
                        return { message: "CPF já cadastrado." };
                    }
                } else if (contact.TipoPessoa === "1" && contact.CNPJ) {
                    const exists = await prisma.cRM_Contato.count({
                        where: { CNPJ: contact.CNPJ },
                    });
                    if (exists > 0) {
                        set.status = 400;
                        return { message: "CNPJ já cadastrado." };
                    }
                }

                // Create contact
                const newContact = await prisma.cRM_Contato.create({
                    data: {
                        ...contact,
                        idBotConversa: contact.idBotConversa ? parseInt(contact.idBotConversa) : undefined,
                        dtaAbertura: contact.dtaAbertura ? new Date(contact.dtaAbertura) : undefined,
                        dtaCadastro: new Date(),
                        flaAtivo: contact.flaAtivo === "1",
                    },
                });

                // Create address
                await prisma.cRM_Contato_Endereco.create({
                    data: {
                        ...address,
                        idContato: newContact.idContato,
                        flaPrincipal: true,
                        flaAtivo: true,
                        dtaCadastro: new Date(),
                    },
                });

                return { idContato: newContact.idContato, message: "Contato cadastrado com sucesso!" };
            } catch (e) {
                console.error(e);
                set.status = 500;
                return { message: "Erro ao cadastrar contato." };
            }
        },
        {
            body: t.Object({
                contact: t.Object({
                    nomContato: t.Optional(t.String()),
                    nomComercial: t.Optional(t.String()),
                    TipoPessoa: t.String(),
                    CNPJ: t.Optional(t.String()),
                    CPF: t.Optional(t.String()),
                    idRepresentante: t.Optional(t.Number()),
                    IdOrigem: t.Optional(t.Number()),
                    SegmentoAtuacao: t.Optional(t.String()),
                    Telefone: t.Optional(t.String()),
                    TelefoneWS: t.Optional(t.String()),
                    email: t.Optional(t.String()),
                    idBotConversa: t.Optional(t.String()),
                    CodCliente: t.Optional(t.String()),
                    fContato: t.Optional(t.String()),
                    fTelefone: t.Optional(t.String()),
                    fEmail: t.Optional(t.String()),
                    CategoriaFinanceira: t.Optional(t.String()),
                    flaAtivo: t.String(),
                    idUsuarioAt: t.Optional(t.Number()),
                    dtaAbertura: t.Optional(t.String()),
                    Situacao: t.Optional(t.String()),
                    Porte: t.Optional(t.String()),
                    NaturezaJuridica: t.Optional(t.String()),
                    AtividadePrincipal: t.Optional(t.String()),
                    Tipo: t.Optional(t.String()),
                    ContatoEmpresa: t.Optional(t.String()),
                    Segmento: t.Optional(t.String()),
                }),
                address: t.Object({
                    CEP: t.Optional(t.String()),
                    UF: t.Optional(t.String()),
                    Cidade: t.Optional(t.String()),
                    Bairro: t.Optional(t.String()),
                    Endereco: t.Optional(t.String()),
                    Numero: t.Optional(t.String()),
                    Complemento: t.Optional(t.String()),
                    idUsuario: t.Optional(t.Number()),
                }),
            }),
        }
    );
