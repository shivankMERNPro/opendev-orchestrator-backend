export type OllamaFailureCode = 'unavailable' | 'timeout' | 'invalid';

export class OllamaRequestError extends Error {
  readonly code: OllamaFailureCode;

  constructor(code: OllamaFailureCode) {
    super('Ollama request failed');
    this.name = 'OllamaRequestError';
    this.code = code;
  }
}
