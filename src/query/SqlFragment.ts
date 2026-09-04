/** SQL text and interpolated values remain separate until a grammar compiles them. */
export class SqlFragment {
  constructor(readonly strings: readonly string[], readonly values: readonly unknown[]) {}
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
  return new SqlFragment([...strings], values);
}
