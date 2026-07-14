import { Prisma } from "@prisma/client";
import type { Database } from "./client.js";

/**
 * KnowledgeRepository — typed access to `plant_knowledge_base` (RAG store).
 *
 * The table + vector column are provisioned by SQL with a CONFIGURABLE dimension
 * (see prisma/sql/01_knowledge_base.sql.template), so we use $queryRaw here
 * rather than a Prisma model. Embeddings are passed as a pgvector literal.
 */
export interface KnowledgeChunk {
  readonly tenantId: string;
  readonly documentTitle: string;
  readonly contentChunk: string;
  readonly metadata: Record<string, unknown>;
  readonly embedding: readonly number[];
}

export interface SimilarChunk {
  readonly id: string;
  readonly documentTitle: string;
  readonly contentChunk: string;
  readonly distance: number;
}

function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

export class KnowledgeRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Upsert-free insert of one embedded chunk. */
  async insertChunk(chunk: KnowledgeChunk): Promise<void> {
    await this.#db.$executeRaw`
      INSERT INTO plant_knowledge_base
        (tenant_id, document_title, content_chunk, metadata, embedding)
      VALUES (
        ${chunk.tenantId},
        ${chunk.documentTitle},
        ${chunk.contentChunk},
        ${JSON.stringify(chunk.metadata)}::jsonb,
        ${toVectorLiteral(chunk.embedding)}::vector
      )`;
  }

  /** Cosine-nearest chunks for a query embedding, scoped to a tenant. */
  async searchSimilar(
    tenantId: string,
    queryEmbedding: readonly number[],
    limit = 5,
  ): Promise<SimilarChunk[]> {
    const vec = toVectorLiteral(queryEmbedding);
    return this.#db.$queryRaw<SimilarChunk[]>`
      SELECT id::text AS "id",
             document_title AS "documentTitle",
             content_chunk  AS "contentChunk",
             (embedding <=> ${vec}::vector) AS "distance"
      FROM plant_knowledge_base
      WHERE tenant_id = ${tenantId}
      ORDER BY embedding <=> ${vec}::vector
      LIMIT ${Prisma.raw(String(Math.max(1, Math.floor(limit))))}`;
  }
}
