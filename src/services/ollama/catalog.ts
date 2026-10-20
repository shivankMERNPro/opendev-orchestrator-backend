export interface CatalogModel {
  name: string;
  note: string;
}

export const MODEL_CATALOG: readonly CatalogModel[] = [
  {
    name: 'llama3.2',
    note: 'Known Ollama library identifier. Size and availability are not reported here.',
  },
  {
    name: 'llama3.1',
    note: 'Known Ollama library identifier. Size and availability are not reported here.',
  },
  {
    name: 'qwen2.5-coder',
    note: 'Known Ollama library identifier. Size and availability are not reported here.',
  },
  {
    name: 'gemma2',
    note: 'Known Ollama library identifier. Size and availability are not reported here.',
  },
  {
    name: 'phi3',
    note: 'Known Ollama library identifier. Size and availability are not reported here.',
  },
  {
    name: 'mistral',
    note: 'Known Ollama library identifier. Size and availability are not reported here.',
  },
  {
    name: 'nomic-embed-text',
    note: 'Known Ollama library identifier. Size and availability are not reported here.',
  },
  {
    name: 'deepseek-r1',
    note: 'Known Ollama library identifier. Size and availability are not reported here.',
  },
];

const CATALOG_QUERY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,80}$/;

export type CatalogQueryResult =
  { ok: true; models: CatalogModel[] } | { ok: false };

export function searchCatalog(query: string | undefined): CatalogQueryResult {
  const needle = query?.trim() ?? '';
  if (needle.length === 0) {
    return { ok: true, models: [...MODEL_CATALOG] };
  }
  if (
    needle.includes('..') ||
    needle.includes('://') ||
    !CATALOG_QUERY.test(needle)
  ) {
    return { ok: false };
  }

  const folded = needle.toLowerCase();
  return {
    ok: true,
    models: MODEL_CATALOG.filter((entry) =>
      entry.name.toLowerCase().includes(folded),
    ),
  };
}
