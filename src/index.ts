import { Elysia } from "elysia";

import { cors } from "@elysiajs/cors";
import { activitiesRoutes } from "./routes/activities";
import { authRoutes } from "./routes/auth";
import { contactsRoutes } from "./routes/contacts";
import { dashboardRoutes } from "./routes/dashboard";
import { proposalsRoutes } from "./routes/proposals";
import { stockRoutes } from "./routes/stock";
import { usersRoutes } from "./routes/users";
import openapi from '@elysiajs/openapi';
import {representativesRoutes} from "./routes/representatives";
import {leadsRoutes, origemRoutes, statusRoutes} from "./routes/leads";
import {arquivosRoutes, atividadeStatusRoutes, atividadeTipoRoutes, interacaoRoutes} from "./routes/interacao";
import { pedidoNfeRoutes } from "./routes/pedido-nfe";
import { pipelineRoutes } from "./routes/pipeline";
import { proposalEditRoutes } from "./routes/proposal-edit";
import { checagemRoutes } from "./routes/checagem";
import { expedicaoRoutes } from "./routes/expedicao";
import { producaoRoutes } from "./routes/producao";
import { separacaoRoutes } from "./routes/separacao";
import { rastreamentoRoutes } from "./routes/rastreamento";
import { agendaRoutes } from "./routes/agenda";
import { dashboardStatsRoutes } from "./routes/dashboard-stats";
import { lixeiraRoutes } from "./routes/lixeira";
import { perfilRoutes } from "./routes/perfil";
import { tabelaPrecoRoutes } from "./routes/tabela-preco";
import { estoqueImportRoutes } from "./routes/estoque-import";
import { comprasRoutes, fornecedorRoutes } from "./routes/compras";
import { ocorrenciasRoutes } from "./routes/ocorrencias";
import { adminRoutes } from "./routes/admin";
import { feriadosRoutes } from "./routes/feriados";
import { followupRoutes } from "./routes/followup";
import { perfisRoutes } from "./routes/perfis";
import { fiscalRoutes } from "./routes/fiscal";
import { actionLogger } from "./lib/action-logger";

const {URL, PORT} = Bun.env;


export const app = new Elysia()
  .use(cors())
  .use(actionLogger)
  .get('/', ({ redirect }) => redirect('/docs'), { detail: { hide: true } })
  .use(stockRoutes)
  .use(authRoutes)
  .use(usersRoutes)
  .use(contactsRoutes)
  .use(proposalsRoutes)
  .use(activitiesRoutes)
  .use(dashboardRoutes)
  .use(representativesRoutes)
  .use(leadsRoutes)
  .use(origemRoutes)
  .use(statusRoutes)
    .use(interacaoRoutes)
    .use(activitiesRoutes)
    .use(arquivosRoutes)
    .use(atividadeStatusRoutes)
    .use(atividadeTipoRoutes)
    .use(pedidoNfeRoutes)
    .use(pipelineRoutes)
    .use(proposalEditRoutes)
    .use(checagemRoutes)
    .use(expedicaoRoutes)
    .use(producaoRoutes)
    .use(separacaoRoutes)
    .use(rastreamentoRoutes)
    .use(agendaRoutes)
    .use(dashboardStatsRoutes)
    .use(lixeiraRoutes)
    .use(perfilRoutes)
    .use(tabelaPrecoRoutes)
    .use(estoqueImportRoutes)
    .use(comprasRoutes)
    .use(fornecedorRoutes)
    .use(ocorrenciasRoutes)
    .use(adminRoutes)
    .use(feriadosRoutes)
    .use(followupRoutes)
    .use(perfisRoutes)
    .use(fiscalRoutes)
  .use(openapi({
        path: '/docs',
        documentation: {
            info: {
                version: '1.0.0',
                title: 'CRM Eltech - API',
                description: [
                    'Documentacao da API do CRM Eltech.',
                    '',
                    '**Modulos disponiveis:**',
                    '- **Auth** — Autenticacao e sessao',
                    '- **Contatos** — Cadastro, listagem, interacao e lixeira',
                    '- **Propostas** — Criacao, edicao, checagem, pipeline e proposta comercial',
                    '- **Atividades** — Registro e consolidacao de atividades comerciais',
                    '- **Producao** — Acompanhamento de producao e concluidos',
                    '- **Expedicao** — Separacao, rastreamento e interacao',
                    '- **Pedidos/NF-e** — Gestao de pedidos em aberto',
                    '- **Estoque** — Consulta e importacao',
                    '- **Compras** — Catalogo de materiais e fornecedores',
                    '- **Tabela de Preco** — Importacao e publicacao',
                    '- **Ocorrencias** — RNC, RFE, Contato e Colaborador',
                    '- **Admin** — Transferencia de carteira, convites, log e feriados',
                    '- **Dashboard** — Indicadores e estatisticas',
                ].join('\n'),
                contact: {
                    url: 'https://brapri.com',
                    name: 'Brapri Development Team',
                    email: 'dev@brapri.com'
                },
                license: {
                    name: 'Brapri License',
                    url: 'https://brapri.com/license'
                },
                termsOfService: 'https://brapri.com/terms'
            },
            openapi: '3.0.0',
            servers: [{ url: URL ? `https://${URL}` : `http://localhost:${PORT || 3000}` }],
            tags: [
                { name: 'Auth', description: 'Autenticacao e sessao' },
                { name: 'Contatos', description: 'Cadastro e gestao de contatos/clientes' },
                { name: 'Propostas', description: 'Criacao e edicao de propostas comerciais' },
                { name: 'Pipeline', description: 'Funil de vendas e leads' },
                { name: 'Atividades', description: 'Atividades comerciais' },
                { name: 'Producao', description: 'Acompanhamento de producao' },
                { name: 'Expedicao', description: 'Separacao, rastreamento e despacho' },
                { name: 'Pedidos', description: 'Pedidos em aberto e NF-e' },
                { name: 'Estoque', description: 'Consulta e importacao de estoque' },
                { name: 'Compras', description: 'Catalogo de materiais e fornecedores' },
                { name: 'Tabela de Preco', description: 'Importacao e publicacao de precos' },
                { name: 'Ocorrencias', description: 'RNC, RFE, Contato e Colaborador' },
                { name: 'Admin', description: 'Painel administrativo' },
                { name: 'Dashboard', description: 'Indicadores e estatisticas' },
                { name: 'Usuarios', description: 'Gestao de usuarios' },
            ],
        }
    }))
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);