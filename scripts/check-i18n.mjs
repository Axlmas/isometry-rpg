// Validates the translation catalogue. Run with: npm run i18n:check
//
// Fails when:
//  - a locale is missing a key that English has, or has a key English lacks;
//  - a message is not valid ICU MessageFormat, or uses different arguments
//    than the English message;
//  - the code uses a key that does not exist, or a key is no longer used;
//  - a translator note refers to a key that does not exist.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';

const LOCALES_DIR = 'src/i18n/locales';
const SOURCE = 'en';
const errors = [];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const catalogues = Object.fromEntries(
  readdirSync(LOCALES_DIR)
    .filter((file) => file.endsWith('.json') && !file.startsWith('_'))
    .map((file) => [file.replace('.json', ''), readJson(join(LOCALES_DIR, file))]),
);
const source = catalogues[SOURCE];
const sourceKeys = Object.keys(source);

/** Collects argument names from a parsed ICU message, including nested plural/select branches. */
function argumentsOf(ast, found = new Set()) {
  for (const node of ast) {
    if (node.value && node.type !== 0) found.add(node.value);
    for (const option of Object.values(node.options ?? {})) argumentsOf(option.value, found);
  }
  return found;
}

function parse(locale, key, message) {
  try {
    return argumentsOf(new IntlMessageFormat(message, locale).getAst());
  } catch (error) {
    errors.push(`${locale}: "${key}" is not a valid ICU message (${error.message})`);
    return null;
  }
}

for (const [locale, messages] of Object.entries(catalogues)) {
  for (const key of sourceKeys) {
    if (!(key in messages)) errors.push(`${locale}: missing "${key}"`);
  }
  for (const [key, message] of Object.entries(messages)) {
    if (!(key in source)) {
      errors.push(`${locale}: "${key}" does not exist in ${SOURCE}`);
      continue;
    }
    if (typeof message !== 'string' || message.trim() === '') {
      errors.push(`${locale}: "${key}" is empty`);
      continue;
    }
    const expected = parse(SOURCE, key, source[key]);
    const actual = parse(locale, key, message);
    if (expected && actual && [...expected].sort().join() !== [...actual].sort().join()) {
      errors.push(`${locale}: "${key}" uses {${[...actual]}} but ${SOURCE} uses {${[...expected]}}`);
    }
  }
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|html)$/.test(name) ? [path] : [];
  });
}

// Keys must be written as string literals so this check can find them:
// t('some.key'), toast('some.key') or data-i18n="some.key".
const used = new Set();
for (const file of ['index.html', ...sourceFiles('src')]) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)'|data-i18n="([^"]+)"/g)) {
    const key = match[1] ?? match[2];
    if (match[2] || key in source) used.add(key);
    if (match[2] && !(key in source)) errors.push(`${file}: uses unknown key "${key}"`);
  }
  for (const match of text.matchAll(/\b(?:t|toast)\(\s*'([^']+)'/g)) {
    if (!(match[1] in source)) errors.push(`${file}: uses unknown key "${match[1]}"`);
  }
}
for (const key of sourceKeys) {
  if (!used.has(key)) errors.push(`${SOURCE}: "${key}" is not used anywhere`);
}

for (const key of Object.keys(readJson(join(LOCALES_DIR, '_notes.json')))) {
  if (!(key in source)) errors.push(`_notes.json: note for unknown key "${key}"`);
}

if (errors.length > 0) {
  console.error(`Translation check failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`Translations OK: ${sourceKeys.length} keys in ${Object.keys(catalogues).join(', ')}.`);
