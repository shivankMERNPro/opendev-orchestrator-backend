const PARAMETER_TAG = /^(\d+(?:\.\d+)?)b$/i;

export interface ParameterVariant {
  tag: string;
  parameterSize: string;
}

export function parameterLabel(tag: string): string | null {
  const match = PARAMETER_TAG.exec(tag.trim());
  const amount = match?.[1];
  if (amount === undefined) {
    return null;
  }
  return `${amount}B`;
}

export function selectParameterTags(
  tags: readonly string[],
): ParameterVariant[] {
  const seen = new Set<string>();
  const variants: ParameterVariant[] = [];
  for (const tag of tags) {
    const label = parameterLabel(tag);
    if (label === null) {
      continue;
    }
    const normalized = tag.trim().toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    variants.push({ tag: normalized, parameterSize: label });
  }
  variants.sort(
    (left, right) => Number.parseFloat(left.tag) - Number.parseFloat(right.tag),
  );
  return variants.slice(0, 12);
}
