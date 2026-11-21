import { PrismaService } from './prisma.service.js';
import { SEED_PRESTADORES, seedPrestadores } from './seed-data.js';

const prisma = new PrismaService();
await seedPrestadores(prisma);
await prisma.$disconnect();
console.log(`Seeded ${SEED_PRESTADORES.length} Prestadores`);
