import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLicenseNotices } from './license-notices.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
fs.writeFileSync(path.join(root, 'static', 'THIRD-PARTY-NOTICES.txt'), generateLicenseNotices(root));
