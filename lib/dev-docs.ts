import fs from 'node:fs';
import path from 'node:path';

/** docs/simulator.md, the developers' documentation (#355), with the site's own address in its examples */
export function devDocs(site: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'docs/simulator.md'), 'utf8').replaceAll('{{SITE}}', site);
}
