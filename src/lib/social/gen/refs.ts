import type { DataRef } from '../types';

/**
 * A figure ready to show: the exact text a reader sees plus the data_ref that says where it came from.
 * Builders only put figures on slides and in captions through RefBook.use(), so a number cannot appear without a ref.
 */
export interface Fig {
  text: string;
  ref: DataRef;
}

export const fig = (table: string, id: string, field: string, text: string): Fig => ({ text, ref: { table, id, field, value: text } });

export class RefBook {
  private readonly seen = new Map<string, DataRef>();

  /** Records the figure's ref (once) and returns its text. */
  use(f: Fig): string {
    const key = `${f.ref.table}|${f.ref.id}|${f.ref.field}|${f.ref.value}`;
    if (!this.seen.has(key)) this.seen.set(key, f.ref);
    return f.text;
  }

  get refs(): DataRef[] {
    return [...this.seen.values()];
  }
}
