import { PrismaMssql } from '@prisma/adapter-mssql';
import "dotenv/config";
import { PrismaClient } from '../generated/prisma/client';

const connectionString = process.env.DATABASE_URL || '';
const [hostPort, ...rest] = connectionString.replace('sqlserver://', '').split(';');
const [server] = hostPort.split(':');
const params = Object.fromEntries(rest.map((p) => p.split('=')));

const sqlConfig = {
  user: params.user,
  password: params.password,
  database: params.database,
  server,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const adapter = new PrismaMssql(sqlConfig as any)
const prisma = new PrismaClient({ adapter });

export { prisma };
