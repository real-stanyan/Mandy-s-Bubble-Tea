import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');
const envText = readFileSync(envPath, 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

console.log('URL:', process.env.SUPABASE_URL);
console.log('Key length:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length);

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ch = supa.channel('test-broadcast', { config: { broadcast: { self: true } } });

const start = Date.now();
ch.subscribe((status, err) => {
  const t = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`[${t}s] status:`, status, err ? 'err=' + JSON.stringify(err) : '');
});

setTimeout(() => {
  console.log('timeout reached, exiting');
  process.exit(0);
}, 15000);
