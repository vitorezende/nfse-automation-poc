import { PrismaService } from './prisma.service.js';

// Fictitious Prestadores. CNPJs and credential references must match the Portal da Prefeitura
// seed and the Robô de Emissão's credential store.
export const SEED_PRESTADORES = [
  {
    cnpj: '11.111.111/0001-11',
    name: 'ACME Tecnologia Ltda',
    credentialRef: 'prestador-acme',
    servicos: [
      { code: '01.07', description: 'Suporte técnico em informática', issRate: '0.0500' },
      { code: '01.05', description: 'Licenciamento de programas de computador', issRate: '0.0200' },
    ],
  },
  {
    cnpj: '22.333.444/0001-55',
    name: 'Beta Consultoria ME',
    credentialRef: 'prestador-beta',
    servicos: [
      { code: '17.01', description: 'Assessoria ou consultoria de qualquer natureza', issRate: '0.0300' },
      { code: '17.19', description: 'Contabilidade', issRate: '0.0250' },
    ],
  },
  {
    cnpj: '33.444.555/0001-66',
    name: 'Gama Engenharia S.A.',
    credentialRef: 'prestador-gama',
    servicos: [
      { code: '07.02', description: 'Execução de obras de construção civil', issRate: '0.0250' },
      { code: '07.03', description: 'Elaboração de projetos de engenharia', issRate: '0.0400' },
    ],
  },
];

/** Idempotent: creates missing Prestadores and Serviços, never touches RPS counters. */
export async function seedPrestadores(prisma: PrismaService): Promise<void> {
  for (const { servicos, ...data } of SEED_PRESTADORES) {
    const prestador = await prisma.prestador.upsert({
      where: { cnpj: data.cnpj },
      create: data,
      update: { name: data.name, credentialRef: data.credentialRef },
    });
    for (const servico of servicos) {
      const exists = await prisma.servico.findFirst({ where: { prestadorId: prestador.id, code: servico.code } });
      if (!exists) await prisma.servico.create({ data: { ...servico, prestadorId: prestador.id } });
    }
  }
}
