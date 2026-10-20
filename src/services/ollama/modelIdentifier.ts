const MODEL_IDENTIFIER =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62})\/)?[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})(?::[A-Za-z0-9](?:[A-Za-z0-9._-]{0,63}))?$/;

export function parseModelIdentifier(value: string): string | null {
  const name = value.trim();
  if (name.length < 1 || name.length > 128) {
    return null;
  }
  if (
    name.includes('..') ||
    name.includes('://') ||
    name.includes('\\') ||
    name.includes('@') ||
    name.includes('?') ||
    name.includes('#')
  ) {
    return null;
  }
  if (!MODEL_IDENTIFIER.test(name)) {
    return null;
  }
  return name;
}

export function composeModelIdentifier(
  model: string,
  tag: string | undefined,
): string | null {
  if (tag === undefined) {
    return parseModelIdentifier(model);
  }

  const name = model.trim();
  const suffix = tag.trim();
  if (name.includes(':') || suffix.includes(':') || suffix.includes('/')) {
    return null;
  }
  return parseModelIdentifier(`${name}:${suffix}`);
}
