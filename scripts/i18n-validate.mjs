/**
 * i18n catalog validation (CI + local: `pnpm i18n:check`).
 *
 * Rejects, with a non-zero exit:
 *   1. unknown locale ids — a catalog file whose name is not a registered
 *      locale id, or a registered locale id without a catalog file;
 *   2. missing English source keys — a key present in zh-CN/ja but missing
 *      from the English source catalog (English is the source of truth);
 *   3. missing required keys — a required English key absent from a locale
 *      catalog (only OPTIONAL_KEYS may be omitted);
 *   4. unsafe message interpolation — HTML markup inside messages, `${`
 *      template injection, unknown placeholder tokens, or placeholder sets
 *      that diverge from the English source for the same key.
 *
 * Runs on Node.js 24 with native TypeScript type stripping.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const importTs = (path) => import(pathToFileURL(path).href);

const { LOCALE_IDS, FALLBACK_LOCALE, OPTIONAL_KEYS, MESSAGE_PARAMS } = await importTs(
  join(root, 'src/i18n/registry.ts'),
);
const messagesDir = join(root, 'src/i18n/messages');

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.error(`✗ ${message}`);
};

const catalogs = {};
for (const locale of LOCALE_IDS) {
  catalogs[locale] = (await importTs(join(messagesDir, `${locale}.ts`)))[
    locale === 'zh-CN' ? 'zhCN' : locale
  ];
  if (!catalogs[locale] || typeof catalogs[locale] !== 'object') {
    fail(`Catalog for "${locale}" does not export an object`);
  }
}

// 1. Unknown locale ids / missing catalogs.
const files = readdirSync(messagesDir).filter((f) => f.endsWith('.ts'));
for (const file of files) {
  const id = basename(file, '.ts');
  if (!LOCALE_IDS.includes(id)) {
    fail(`Unknown locale id "${id}" in messages dir (file ${file})`);
  }
}
for (const locale of LOCALE_IDS) {
  if (!files.includes(`${locale}.ts`)) {
    fail(`Registered locale "${locale}" has no catalog file`);
  }
}

if (FALLBACK_LOCALE !== 'en') {
  fail(`FALLBACK_LOCALE must be "en" (English is the deterministic fallback), got "${FALLBACK_LOCALE}"`);
}

const enCatalog = catalogs[FALLBACK_LOCALE];
const enKeys = Object.keys(enCatalog);

// 4. English source hygiene: no markup, no ${}, placeholders declared.
const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;
for (const key of enKeys) {
  const message = enCatalog[key];
  if (typeof message !== 'string') {
    fail(`English message "${key}" is not a string`);
    continue;
  }
  if (/[<>]/.test(message)) {
    fail(`Unsafe interpolation in English message "${key}": HTML markup is not allowed in messages`);
  }
  if (message.includes('${')) {
    fail(`Unsafe interpolation in English message "${key}": "\${" template syntax is not allowed`);
  }
  const tokens = [...message.matchAll(PLACEHOLDER)].map((m) => m[1]);
  const declared = MESSAGE_PARAMS[key] ?? [];
  for (const token of tokens) {
    if (!declared.includes(token)) {
      fail(`Unsafe interpolation in English message "${key}": token "{${token}}" is not declared in MESSAGE_PARAMS`);
    }
  }
  for (const param of declared) {
    if (!tokens.includes(param)) {
      fail(`English message "${key}": MESSAGE_PARAMS declares "{${param}}" but the message never uses it`);
    }
  }
}

// 2 + 3. Locale catalogs vs English source.
for (const locale of LOCALE_IDS) {
  if (locale === FALLBACK_LOCALE) continue;
  const catalog = catalogs[locale];
  if (!catalog) continue;
  for (const key of Object.keys(catalog)) {
    if (!enKeys.includes(key)) {
      fail(`"${locale}" catalog has key "${key}" that is missing from the English source (missing English source key)`);
    }
  }
  for (const key of enKeys) {
    const message = catalog[key];
    if (message === undefined) {
      if (!OPTIONAL_KEYS.includes(key)) {
        fail(`"${locale}" catalog is missing required key "${key}" (only OPTIONAL_KEYS may be omitted)`);
      }
      continue;
    }
    if (typeof message !== 'string') {
      fail(`"${locale}" message "${key}" is not a string`);
      continue;
    }
    if (/[<>]/.test(message)) {
      fail(`Unsafe interpolation in "${locale}" message "${key}": HTML markup is not allowed in messages`);
    }
    if (message.includes('${')) {
      fail(`Unsafe interpolation in "${locale}" message "${key}": "\${" template syntax is not allowed`);
    }
    const tokens = [...message.matchAll(PLACEHOLDER)].map((m) => m[1]);
    const enTokens = [...enCatalog[key].matchAll(PLACEHOLDER)].map((m) => m[1]);
    const sameSet = tokens.length === enTokens.length && tokens.every((t) => enTokens.includes(t));
    if (!sameSet) {
      fail(
        `"${locale}" message "${key}" placeholder set [${tokens.join(', ')}] differs from English [${enTokens.join(', ')}]`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`\ni18n validation failed with ${failures.length} problem(s).`);
  process.exit(1);
}

console.log(
  `✓ i18n validation passed: ${LOCALE_IDS.length} registered locales (${LOCALE_IDS.join(', ')}), ` +
    `${enKeys.length} English source keys, ${OPTIONAL_KEYS.length} optional key(s).`,
);
