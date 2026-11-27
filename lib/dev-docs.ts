import fs from 'node:fs';
import path from 'node:path';

const read = (file: string, site: string) => fs.readFileSync(path.join(process.cwd(), 'docs', file), 'utf8').replaceAll('{{SITE}}', site);

/** docs/simulator.md, the developers' documentation (#355), with the site's own address in its examples */
export const devDocs = (site: string): string => read('simulator.md', site);
/** docs/agents.md, how an agent competes (its account, its networks), likewise */
export const agentDocs = (site: string): string => read('agents.md', site);
