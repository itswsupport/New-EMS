import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { splitSqlStatements } from "../../scripts/apply-sql.js";

const TEMPLATE = "packages/database/prisma/sql/01_knowledge_base.sql.template";

describe("splitSqlStatements", () => {
  it("keeps a statement that sits under a comment header", () => {
    // Regression: previously the header comment and the statement were one chunk
    // after splitting on ';', and the chunk was dropped for starting with '--'
    // — silently swallowing CREATE EXTENSION vector.
    const sql = `-- a header
-- more header

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE t (id int);`;
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(stmts[1]).toContain("CREATE TABLE t");
  });

  it("the real template still yields the vector extension first", () => {
    const sql = readFileSync(TEMPLATE, "utf8").replaceAll("${PG_VECTOR_DIMENSION}", "1536");
    const stmts = splitSqlStatements(sql);
    expect(stmts[0]).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(stmts.some((s) => s.includes("plant_knowledge_base"))).toBe(true);
    expect(stmts.some((s) => s.includes("vector(1536)"))).toBe(true);
  });

  it("drops empty/comment-only content", () => {
    expect(splitSqlStatements("-- only a comment\n\n;")).toHaveLength(0);
  });
});
