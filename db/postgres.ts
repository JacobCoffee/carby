import type { Pool, PoolClient, QueryResultRow } from "pg";

type Row = Record<string, unknown>;
export type QueryResult<T = Row> = { results: T[]; meta: { changes: number } };
export interface Statement {
  bind(...params: unknown[]): Statement;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<QueryResult<T>>;
  run<T = Row>(): Promise<QueryResult<T>>;
}
export interface Database {
  prepare(sql: string): Statement;
  /** Runs every statement in one serializable transaction: all of them apply, or none do. */
  batch<T = Row>(statements: Statement[]): Promise<QueryResult<T>[]>;
}
type Queryable = Pick<Pool | PoolClient, "query">;

class PgStatement implements Statement {
  constructor(
    private readonly database: Database,
    private readonly pool: Queryable,
    readonly text: string,
    readonly params: readonly unknown[] = [],
  ) {}
  bind(...params: unknown[]): Statement {
    // pg would silently send undefined as NULL; a missing value is a caller bug.
    if (params.includes(undefined)) throw new TypeError("undefined cannot be bound");
    return new PgStatement(this.database, this.pool, this.text, params);
  }
  async execute<T>(client: Queryable = this.pool): Promise<QueryResult<T>> {
    const result = await client.query<QueryResultRow>(this.text, [...this.params]);
    // rowCount is the row count of a SELECT too; changes counts only rows written.
    const changes = result.command === "SELECT" ? 0 : (result.rowCount ?? 0);
    return { results: result.rows as T[], meta: { changes } };
  }
  async first<T = Row>(): Promise<T | null> {
    return (await this.execute<T>()).results[0] ?? null;
  }
  all<T = Row>(): Promise<QueryResult<T>> {
    return this.execute<T>();
  }
  run<T = Row>(): Promise<QueryResult<T>> {
    return this.execute<T>();
  }
  belongsTo(database: Database) {
    return this.database === database;
  }
}

// serialization_failure and deadlock_detected: the transaction rolled back and can run again.
const RETRYABLE = new Set(["40001", "40P01"]);
const ATTEMPTS = 8;
const code = (error: unknown) =>
  error && typeof error === "object" && "code" in error ? error.code : undefined;

/** The one Database implementation, over any pg pool (the app's, or a test's). */
export function makeDatabase(pool: Pool): Database {
  const database: Database = {
    prepare: (sql) => new PgStatement(database, pool, sql),
    async batch<T = Row>(statements: Statement[]) {
      const list = statements.map((statement) => {
        if (!(statement instanceof PgStatement) || !statement.belongsTo(database))
          throw new TypeError("batch() accepts statements prepared by this database");
        return statement;
      });
      if (!list.length) return [];
      // A batch is a fixed list of statements, so rerunning it after a serialization failure
      // is the same as running it later, one transaction at a time.
      for (let attempt = 1; ; attempt++) {
        const client = await pool.connect();
        // A connection that cannot roll back is discarded rather than returned to the pool.
        let broken: Error | undefined;
        try {
          await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
          const results: QueryResult<T>[] = [];
          for (const statement of list) results.push(await statement.execute<T>(client));
          await client.query("COMMIT");
          return results;
        } catch (error) {
          await client.query("ROLLBACK").catch((rollback: unknown) => {
            broken = rollback instanceof Error ? rollback : new Error("rollback failed");
          });
          if (broken || attempt >= ATTEMPTS || !RETRYABLE.has(String(code(error)))) throw error;
        } finally {
          client.release(broken);
        }
        // Full jitter, doubling each attempt: at most about 3 seconds across every retry.
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 25 * 2 ** (attempt - 1)),
        );
      }
    },
  };
  return database;
}
