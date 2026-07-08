import { Elysia } from "elysia";
import { prisma } from "./prisma";

const routeLabels: Record<string, Record<string, string>> = {
  POST: {
    "/contacts": "Criou contato",
    "/proposals": "Criou proposta",
    "/proposals/checagem": "Checagem de proposta",
    "/leads": "Criou lead",
    "/activities": "Registrou atividade",
    "/admin/transferir-carteira": "Transferência de carteira",
    "/admin/convites": "Criou convite",
    "/admin/feriados": "Cadastrou feriado",
    "/users": "Cadastrou usuário",
    "/interacao": "Registrou interação",
    "/ocorrencias": "Registrou ocorrência",
    "/pipeline/mover": "Moveu pipeline",
  },
  PUT: {
    "/users": "Editou usuário",
    "/contacts": "Editou contato",
    "/proposals": "Editou proposta",
    "/perfil": "Editou perfil",
  },
  DELETE: {
    "/contacts": "Excluiu contato",
    "/proposals": "Excluiu proposta",
    "/leads": "Excluiu lead",
    "/admin/feriados": "Excluiu feriado",
  },
};

function matchRoute(method: string, path: string): string | null {
  const map = routeLabels[method];
  if (!map) return null;
  if (map[path]) return map[path];
  for (const pattern in map) {
    if (path.startsWith(pattern + "/") || path.startsWith(pattern + "?")) {
      return map[pattern];
    }
  }
  return null;
}

export const actionLogger = new Elysia({ name: "action-logger" })
  .onAfterResponse(async ({ request, set }) => {
    try {
      const method = request.method;
      if (method !== "POST" && method !== "PUT" && method !== "DELETE") return;

      const url = new URL(request.url);
      const path = url.pathname;
      const label = matchRoute(method, path);
      if (!label) return;

      const status = typeof set.status === "number" ? set.status : 200;
      if (status >= 400) return;

      const userId = request.headers.get("x-user-id");
      if (!userId || isNaN(Number(userId))) return;

      const ocorrencia = `${method} ${path}`;

      await prisma.$queryRawUnsafe(`
        INSERT INTO CRM_Log (idUsuario, Data, Atividade, Ocorrencia)
        VALUES (${Number(userId)}, GETDATE(), '${label.replace(/'/g, "''")}', '${ocorrencia.replace(/'/g, "''")}')
      `);
    } catch (e) {
      console.error("[action-logger]", e);
    }
  });
