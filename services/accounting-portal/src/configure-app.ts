import type { NestExpressApplication } from '@nestjs/platform-express';
import hbs from 'hbs';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const viewsDir = join(import.meta.dirname, '..', 'views');

/** HTTP setup shared by main.ts and the boundary tests. */
export function configureApp(app: NestExpressApplication): void {
  app.setBaseViewsDir(viewsDir);
  app.setViewEngine('hbs');
  // Registered synchronously: hbs.registerPartials is async and would race the first render.
  const partialsDir = join(viewsDir, 'partials');
  for (const file of readdirSync(partialsDir).filter((f) => f.endsWith('.hbs'))) {
    hbs.registerPartial(basename(file, '.hbs'), readFileSync(join(partialsDir, file), 'utf8'));
  }
}
