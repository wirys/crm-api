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

const {URL, PORT} = Bun.env;


export const app = new Elysia()
  .use(cors())
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
  .use(openapi({
        path: '/docs',
        documentation: {
            info: {
                version: '0.0.1',
                title: 'CRM - Eltech',
                description: `API documentation for Eltech Core and related Services.<br>Authentication routes: http://${URL || 'localhost:' + PORT}/auth/docs`,
                contact: {
                    url: 'https://brapri.com',
                    name: 'Need help? Contact Brapri Development Team!',
                    email: 'dev@brapri.com'
                },
                license: {
                    name: 'Brapri License',
                    url: 'https://brapri.com/license'
                },
                termsOfService: 'https://flamus.com/terms'
            },
            openapi: '3.0.0',
            // servers: [{url: URL}]
        }
    }))
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);