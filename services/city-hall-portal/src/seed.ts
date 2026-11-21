// Seeds the fictitious Prestadores and their Prefeitura logins. Idempotent.
// Keep in sync with the robot's credential store and the Portal da Contabilidade seed.
import { hashPassword } from './auth/password.js';
import { PrismaService } from './prisma.service.js';

export const SEED_PRESTADORES = [
  { cnpj: '11.111.111/0001-11', name: 'ACME Tecnologia Ltda', username: 'acme', password: 'acme-pass' },
  { cnpj: '22.333.444/0001-55', name: 'Beta Consultoria ME', username: 'beta', password: 'beta-pass' },
  { cnpj: '33.444.555/0001-66', name: 'Gama Engenharia S.A.', username: 'gama', password: 'gama-pass' },
];

const prisma = new PrismaService();
for (const { password, ...prestador } of SEED_PRESTADORES) {
  const passwordHash = await hashPassword(password);
  await prisma.prestador.upsert({
    where: { cnpj: prestador.cnpj },
    create: { ...prestador, passwordHash },
    update: { name: prestador.name, username: prestador.username, passwordHash },
  });
}
await prisma.$disconnect();
console.log(`Seeded ${SEED_PRESTADORES.length} Prestadores`);
