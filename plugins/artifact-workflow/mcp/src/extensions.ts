import { randomUUID } from 'node:crypto';
import fs, { lstat, mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod/v4';
import { StoreError, systemErrorCode } from './errors.js';
import { writeFileAtomically } from './snapshot-files.js';

const text = z.string().trim().min(1).max(100_000);
const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
export const extensionSchema = z.strictObject({
  id: idSchema,
  name: text.max(200),
  type: z.enum(['generation', 'review']),
  target: text,
  applicability: text,
  summary: text.max(2_000),
  instructions: text,
  dependencies: z.array(text.max(2_000)).max(100).default([]),
});
const storedEntrySchema = z.strictObject({
  ...extensionSchema.shape,
  revision: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const documentSchema = z
  .strictObject({ schemaVersion: z.literal(1), entries: z.array(storedEntrySchema) })
  .superRefine(({ entries }, ctx) => {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', message: `Duplicate extension ID: ${entry.id}` });
      ids.add(entry.id);
    }
  });
export type ExtensionInput = z.input<typeof extensionSchema>;
export type Extension = z.infer<typeof storedEntrySchema>;
export const storedExtensionSchema = storedEntrySchema;
export const extensionSummarySchema = z.strictObject({
  id: idSchema,
  name: text.max(200),
  type: z.enum(['generation', 'review']),
  target: text,
  applicability: text,
  summary: text.max(2_000),
  dependencies: z.array(text.max(2_000)).max(100),
  revision: z.uuid(),
  updatedAt: z.iso.datetime(),
});
export const extensionSummariesSchema = z.array(extensionSummarySchema);
const MAX_REGISTRY_BYTES = 5_000_000;

/** 永続する登録指示の CRUD。計画ストアのファイルや回収処理から独立させる。 */
export class ExtensionStore {
  private readonly directorySource: string | (() => string);

  constructor(directory: string | (() => string)) {
    this.directorySource = directory;
  }

  get directory() {
    return typeof this.directorySource === 'function' ? this.directorySource() : this.directorySource;
  }
  private get filename() {
    return join(this.directory, 'extensions.json');
  }

  private async write(document: z.infer<typeof documentSchema>) {
    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REGISTRY_BYTES)
      throw new StoreError('INVALID_DATA', 'Extension registry would exceed 5 MiB; no data was written.');
    await writeFileAtomically(this.filename, serialized);
  }

  private async read() {
    try {
      const stat = await lstat(this.filename);
      if (!stat.isFile() || stat.size > MAX_REGISTRY_BYTES)
        throw new StoreError('INVALID_DATA', 'Extension registry is not a regular file or exceeds 5 MiB.');
      const parsed: unknown = JSON.parse(await readFile(this.filename, 'utf8'));
      return documentSchema.parse(parsed);
    } catch (error) {
      if (systemErrorCode(error) === 'ENOENT') return { schemaVersion: 1 as const, entries: [] as Extension[] };
      throw error instanceof StoreError
        ? error
        : new StoreError(
            'INVALID_DATA',
            `Unable to read extension registry: ${error instanceof Error ? error.message : 'invalid data'}`,
          );
    }
  }

  private async locked<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = `${this.filename}.lock`;
    const lock = await fs.open(lockPath, 'wx', 0o600).catch((error) => {
      if (systemErrorCode(error) === 'EEXIST')
        throw new StoreError('SESSION_BUSY', 'Extension registry is being updated by another operation.');
      throw error;
    });
    try {
      return await action();
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }

  async list(filters: { type?: 'generation' | 'review'; query?: string } = {}) {
    const { entries } = await this.read();
    const query = filters.query?.trim().toLocaleLowerCase();
    return entries
      .filter(
        (item) =>
          (!filters.type || item.type === filters.type) &&
          (!query ||
            [item.name, item.target, item.applicability, item.summary].some((value) =>
              value.toLocaleLowerCase().includes(query),
            )),
      )
      .map(({ id, name, type, target, applicability, summary, dependencies, revision, updatedAt }) => ({
        id,
        name,
        type,
        target,
        applicability,
        summary,
        dependencies,
        revision,
        updatedAt,
      }));
  }

  async get(id: string) {
    return (await this.read()).entries.find((entry) => entry.id === id) ?? null;
  }

  async create(input: unknown) {
    const entry = extensionSchema.parse(input);
    return this.locked(async () => {
      const document = await this.read();
      if (document.entries.some((item) => item.id === entry.id))
        throw new StoreError('SESSION_EXISTS', `Extension ID already exists: ${entry.id}`);
      const now = new Date().toISOString();
      const created = { ...entry, revision: randomUUID(), createdAt: now, updatedAt: now };
      await this.write({ ...document, entries: [...document.entries, created] });
      return created;
    });
  }

  async update(id: string, expectedRevision: string, input: unknown) {
    const entry = extensionSchema.parse({ ...(input as object), id });
    if ((input as { id?: unknown } | null)?.id !== id)
      throw new StoreError('INVALID_DATA', 'Extension ID in the update body must match the requested ID.');
    return this.locked(async () => {
      const document = await this.read();
      const index = document.entries.findIndex((item) => item.id === id);
      if (index < 0) return null;
      if (document.entries[index]!.revision !== expectedRevision)
        throw new StoreError('REVISION_CONFLICT', 'Extension revision changed.');
      const updated = {
        ...entry,
        revision: randomUUID(),
        createdAt: document.entries[index]!.createdAt,
        updatedAt: new Date().toISOString(),
      };
      const entries = [...document.entries];
      entries[index] = updated;
      await this.write({ ...document, entries });
      return updated;
    });
  }

  async delete(id: string, expectedRevision: string) {
    return this.locked(async () => {
      const document = await this.read();
      const entry = document.entries.find((item) => item.id === id);
      if (!entry) return false;
      if (entry.revision !== expectedRevision) throw new StoreError('REVISION_CONFLICT', 'Extension revision changed.');
      await this.write({ ...document, entries: document.entries.filter((item) => item.id !== id) });
      return true;
    });
  }
}
