import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MemorySaver } from '@langchain/langgraph';

type Storage = MemorySaver['storage'];
type Writes = MemorySaver['writes'];

const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const decode = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

/**
 * LangGraph's in-memory checkpointer, persisted to one JSON file per run.
 *
 * This replaces the SQLite checkpointer, which pulled in a native addon, an install script and
 * a deprecated transitive dependency for what is a few kilobytes of state. A run has one writer
 * and one thread, so a file rewritten atomically after each step is all the durability it needs.
 */
export class FileCheckpointSaver extends MemorySaver {
  constructor(private readonly file: string) {
    super();
    if (existsSync(file)) this.load();
  }

  private load(): void {
    const saved = JSON.parse(readFileSync(this.file, 'utf8')) as {
      storage: Record<string, Record<string, Record<string, [string, string, string | null]>>>;
      writes: Record<string, Record<string, [string, string, string, string | null]>>;
    };
    const storage: Storage = {};
    for (const [thread, namespaces] of Object.entries(saved.storage)) {
      storage[thread] = {};
      for (const [ns, checkpoints] of Object.entries(namespaces)) {
        storage[thread][ns] = Object.fromEntries(
          Object.entries(checkpoints).map(([id, [checkpoint, metadata, parent]]) => [id, [decode(checkpoint), decode(metadata), parent ?? undefined]]),
        );
      }
    }
    const writes: Writes = {};
    for (const [key, entries] of Object.entries(saved.writes)) {
      writes[key] = Object.fromEntries(
        Object.entries(entries).map(([id, [task, channel, value, path]]) => [id, path == null ? [task, channel, decode(value)] : [task, channel, decode(value), path]]),
      );
    }
    this.storage = storage;
    this.writes = writes;
  }

  private persist(): void {
    const storage = Object.fromEntries(
      Object.entries(this.storage).map(([thread, namespaces]) => [
        thread,
        Object.fromEntries(
          Object.entries(namespaces).map(([ns, checkpoints]) => [
            ns,
            Object.fromEntries(Object.entries(checkpoints).map(([id, [checkpoint, metadata, parent]]) => [id, [encode(checkpoint), encode(metadata), parent ?? null]])),
          ]),
        ),
      ]),
    );
    const writes = Object.fromEntries(
      Object.entries(this.writes).map(([key, entries]) => [
        key,
        Object.fromEntries(Object.entries(entries).map(([id, [task, channel, value, path]]) => [id, [task, channel, encode(value), path ?? null]])),
      ]),
    );
    mkdirSync(dirname(this.file), { recursive: true });
    // Write beside the target and rename, so a crash mid-write never leaves a truncated checkpoint.
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify({ storage, writes }));
    renameSync(temp, this.file);
  }

  override async put(...args: Parameters<MemorySaver['put']>): ReturnType<MemorySaver['put']> {
    const result = await super.put(...args);
    this.persist();
    return result;
  }

  override async putWrites(...args: Parameters<MemorySaver['putWrites']>): ReturnType<MemorySaver['putWrites']> {
    await super.putWrites(...args);
    this.persist();
  }

  override async deleteThread(threadId: string): Promise<void> {
    await super.deleteThread(threadId);
    this.persist();
  }
}
