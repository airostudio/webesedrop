// A minimal, hand-rolled fake of the subset of the @supabase/supabase-js
// query-builder API the domain layer uses (from/select/eq/in/is/not/order/
// update/insert/upsert/single/maybeSingle). Not a general-purpose Postgrest
// emulator — just enough to exercise the domain logic against an in-memory
// table store, mirroring the pattern used across this codebase's other
// fake-db test harnesses.

type Row = Record<string, any>;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `fake-id-${idCounter}`;
}

export class FakeSupabase {
  private tables = new Map<string, Row[]>();

  seed(table: string, rows: Row[]): void {
    this.tables.set(table, rows.map((r) => ({ ...r })));
  }

  rows(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }

  from(table: string): FakeQuery {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return new FakeQuery(table, this.tables);
  }
}

class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  private filters: Array<(row: Row) => boolean> = [];
  private mode: "select" | "update" | "insert" | "upsert" = "select";
  private payload: any;
  private upsertConflict?: string;
  private singleFlag = false;
  private maybeSingleFlag = false;

  constructor(
    private table: string,
    private store: Map<string, Row[]>,
  ) {}

  select(): this {
    return this;
  }
  eq(col: string, value: any): this {
    this.filters.push((row) => row[col] === value);
    return this;
  }
  in(col: string, values: any[]): this {
    this.filters.push((row) => values.includes(row[col]));
    return this;
  }
  is(col: string, value: null): this {
    this.filters.push((row) => row[col] === value || row[col] === undefined);
    return this;
  }
  not(col: string, _op: string, value: null): this {
    this.filters.push((row) => row[col] !== value && row[col] !== undefined);
    return this;
  }
  order(): this {
    return this;
  }
  update(payload: Row): this {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  insert(payload: Row | Row[]): this {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict: string }): this {
    this.mode = "upsert";
    this.payload = payload;
    this.upsertConflict = opts?.onConflict;
    return this;
  }
  single(): this {
    this.singleFlag = true;
    return this;
  }
  maybeSingle(): this {
    this.maybeSingleFlag = true;
    return this;
  }

  private execute(): { data: any; error: any } {
    const table = this.store.get(this.table)!;

    if (this.mode === "select") {
      const matched = table.filter((row) => this.filters.every((f) => f(row)));
      if (this.singleFlag) return { data: matched[0] ?? null, error: matched[0] ? null : { message: "no rows found" } };
      if (this.maybeSingleFlag) return { data: matched[0] ?? null, error: null };
      return { data: matched, error: null };
    }

    if (this.mode === "update") {
      const matched = table.filter((row) => this.filters.every((f) => f(row)));
      matched.forEach((row) => Object.assign(row, this.payload));
      if (this.singleFlag || this.maybeSingleFlag) {
        return { data: matched[0] ?? null, error: this.singleFlag && !matched[0] ? { message: "no rows found" } : null };
      }
      return { data: matched, error: null };
    }

    if (this.mode === "insert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => ({ id: r.id ?? nextId(), ...r }));
      table.push(...rows);
      return this.singleFlag ? { data: rows[0], error: null } : { data: rows, error: null };
    }

    // upsert
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    const results: Row[] = [];
    for (const incoming of rows) {
      let existing: Row | undefined;
      if (this.upsertConflict) {
        const keys = this.upsertConflict.split(",");
        existing = table.find((row) => keys.every((k) => row[k] === incoming[k]));
      }
      if (existing) {
        Object.assign(existing, incoming);
        results.push(existing);
      } else {
        const inserted = { id: incoming.id ?? nextId(), ...incoming };
        table.push(inserted);
        results.push(inserted);
      }
    }
    return this.singleFlag ? { data: results[0], error: null } : { data: results, error: null };
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}
