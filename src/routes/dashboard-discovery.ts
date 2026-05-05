
import fs from "fs";
import { prisma } from "../lib/prisma";

async function main() {
    const data: any = {};

    data.contactStatuses = await prisma.cRM_Status.findMany();

    try {
        data.proposalStatuses = await prisma.$queryRaw`SELECT * FROM CRM_Proposta_Status`;
    } catch (e) {
        data.proposalStatuses = "Error querying CRM_Proposta_Status";
    }

    data.origins = await prisma.cRM_Origem.findMany();

    fs.writeFileSync("discovery_results.json", JSON.stringify(data, null, 2));
    console.log("Results written to discovery_results.json");
}

main();
