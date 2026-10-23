import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { cleanupResultSchema, planSchema, sessionIdSchema, sessionSchema } from './schema.js';
import { StoreError, type StoreErrorCode } from './errors.js';
import type { PlanRepository } from './repository.js';
import { extensionSchema, extensionSummariesSchema, ExtensionStore, storedExtensionSchema } from './extensions.js';

// 保存層は失敗理由だけを返し、利用者への操作案内はMCPの境界で補う。
const errorGuidance: Partial<Record<StoreErrorCode, string>> = {
  INVALID_DIRECTORY: 'ARTIFACT_WORKFLOW_DATA_DIR または PLUGIN_DATA に絶対パスを設定してください。',
  INVALID_DATA:
    '計画を推測・上書きせず保存データを確認してください。reset_session は利用者が対象計画の置換を明示的に許可した場合だけ呼び出してください。',
  NOT_INITIALIZED:
    'initialize_session は新しい生成フローの開始時だけ呼び出してください。後日の修正は新しいタスクとして計画してください。',
  REVISION_CONFLICT:
    'get_plan で最新状態を読み、承認済み計画と照合・確認してから再試行してください。競合回避のためにリセットしてはいけません。',
  SESSION_COMPLETED:
    '後日の修正は新しいタスクとして計画し、新しい sessionId で initialize_session を呼び出してください。',
  SESSION_EXISTS:
    '既存セッションと計画をそのまま保全し、新しいUUIDで initialize_session を呼び出してください。既存計画を続行する場合は、同一フローの明確な続行に限り get_plan を使ってください。',
  PLAN_NOT_SAVED: 'フローを完了する前に、合意済み計画を save_plan で保存してください。',
  SESSION_BUSY:
    '書き込み完了後に再試行してください。プロセスが異常終了した場合は、書き込み中のプロセスがないことを確認してから報告されたロックファイルだけを削除してください。',
  PLAN_TOO_LARGE: '成果物の内容ではなく参照を保存し、完了情報を含むセッションを1 MiB以内にしてください。',
};

async function respond<T extends Record<string, unknown>>(action: () => Promise<T>, failureGuidance?: string) {
  try {
    const result = await action();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    const code = error instanceof StoreError ? error.code : 'STORE_ERROR';
    const message =
      error instanceof StoreError
        ? `${error.message} ${failureGuidance ?? errorGuidance[error.code] ?? '保存データと保存先を確認し、内容を推測して続行しないでください。'}`
        : error instanceof Error
          ? error.message
          : 'Unable to access the plan store.';
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }] };
  }
}

/** 保存実装を受け取り、MCPの入力・出力とエラー応答の契約を提供する。 */
export function createServer(store: PlanRepository, extensions?: ExtensionStore): McpServer {
  const server = new McpServer({ name: 'artifact-task-memory', version: '1.0.0' });
  server.registerTool(
    'initialize_session',
    {
      description:
        '新しい生成フローの開始時に、親だけが新しいUUIDの sessionId で呼び出します。既存セッションと計画は変更せず保全し、SESSION_EXISTS の場合は別UUIDで再度 initialize_session を呼び出してください。同一フローの明確な続行では get_plan を使います。再接続、会話短縮、作業続行、ワーカー起動時には呼び出しません。',
      inputSchema: z.strictObject({ sessionId: sessionIdSchema }),
      outputSchema: z.strictObject({ session: sessionSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ sessionId }) => respond(async () => ({ session: await store.initialize(sessionId) })),
  );
  server.registerTool(
    'reset_session',
    {
      description:
        '親だけが、利用者から対象セッションの置換について明示的な許可を得た場合に呼び出します。指定セッションの計画と完了記録を破棄して初期化します。他のセッションは削除・変更しません。',
      inputSchema: z.strictObject({ sessionId: sessionIdSchema }),
      outputSchema: z.strictObject({ session: sessionSchema }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ sessionId }) => respond(async () => ({ session: await store.reset(sessionId) })),
  );
  server.registerTool(
    'collect_completed_sessions',
    {
      description:
        '親だけが、完了済み計画の回収について利用者から明示的な許可を得た場合に呼び出します。この保存先にある全ての完了記録済みセッションを削除し、他の会話の計画も回収対象になります。未完了セッションは保持します。',
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({ cleanup: cleanupResultSchema }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    () => respond(async () => ({ cleanup: await store.collectCompleted() })),
  );
  server.registerTool(
    'save_plan',
    {
      description:
        '親だけが、要件・タスク・承認根拠を含む合意済み計画全体を保存または置換します。草案や会話履歴は保存しません。通常は initialize_session または get_plan で取得した revision を使います。競合時は最新状態と照合し、回避のためにリセットしてはいけません。',
      inputSchema: z.strictObject({ sessionId: sessionIdSchema, expectedRevision: z.uuid(), plan: planSchema }),
      outputSchema: z.strictObject({ session: sessionSchema }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ sessionId, expectedRevision, plan }) =>
      respond(async () => ({ session: await store.save(sessionId, expectedRevision, plan) })),
  );
  server.registerTool(
    'complete_session',
    {
      description:
        '親だけが、全タスク・フロー全体の検証・成果物の提示または引き渡しを終えた後、その判断を記録します。サーバーは成果物を検証しません。最新の revision を使い、検証中や保存済み計画を使った引き渡しが残る間は完了にしません。完了計画は読み取り専用となり、明示的な reset_session または許可済みの collect_completed_sessions まで保存されます。後日の修正は新しいタスクとして扱います。',
      inputSchema: z.strictObject({ sessionId: sessionIdSchema, expectedRevision: z.uuid() }),
      outputSchema: z.strictObject({ session: sessionSchema }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ sessionId, expectedRevision }) =>
      respond(async () => ({ session: await store.complete(sessionId, expectedRevision) })),
  );
  server.registerTool(
    'get_plan',
    {
      description:
        '親ワークフローの sessionId に対応する最新の合意済み計画、revision、completedAt を読み取ります。委任、作業続行、検証、計画更新の前に確認してください。session が null なら未初期化または回収済み、plan が null なら合意済み計画は未保存です。完了・回収済みフローは再開せず、後日の修正は新しいタスクとして計画してください。',
      inputSchema: z.strictObject({ sessionId: sessionIdSchema }),
      outputSchema: z.strictObject({ session: sessionSchema.nullable() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ sessionId }) => respond(async () => ({ session: await store.get(sessionId) })),
  );
  if (extensions) {
    const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    const revision = z.uuid();
    server.registerTool(
      'register_extension',
      {
        description:
          '生成またはレビューの実行指示を登録します。保存のみを行い、他Skillやコマンドを実行しません。既存IDは上書きせず、別IDを指定してください。',
        inputSchema: extensionSchema,
        outputSchema: z.strictObject({ extension: storedExtensionSchema }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      (input) =>
        respond(
          async () => ({ extension: await extensions.create(input) }),
          '拡張登録の保存に失敗しました。計画セッションのID変更・初期化・リセットは行わず、拡張保存先とデータを確認してください。',
        ),
    );
    server.registerTool(
      'list_extensions',
      {
        description:
          '登録済み指示の軽量メタデータを一覧または絞り込みで返します。全文取得には get_extension を使います。',
        inputSchema: z.strictObject({
          type: z.enum(['generation', 'review']).optional(),
          query: z.string().trim().min(1).max(200).optional(),
        }),
        outputSchema: z.strictObject({ extensions: extensionSummariesSchema }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      ({ type, query }) =>
        respond(
          async () => ({
            extensions: await extensions.list({ ...(type ? { type } : {}), ...(query ? { query } : {}) }),
          }),
          '拡張一覧を取得できませんでした。保存データを空の一覧へ置き換えず、拡張保存先を確認してください。',
        ),
    );
    server.registerTool(
      'get_extension',
      {
        description: 'IDで登録指示の全文・依存情報・revisionを取得します。',
        inputSchema: z.strictObject({ id }),
        outputSchema: z.strictObject({ extension: storedExtensionSchema.nullable() }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      ({ id: extensionId }) =>
        respond(
          async () => ({ extension: await extensions.get(extensionId) }),
          '拡張詳細を取得できませんでした。計画セッションの操作に切り替えず、拡張保存先を確認してください。',
        ),
    );
    server.registerTool(
      'update_extension',
      {
        description:
          '現在のrevisionを指定して登録指示を更新します。revisionが変わっていたら競合として拒否します。指示や依存コマンドは実行しません。',
        inputSchema: z.strictObject({ id, expectedRevision: revision, extension: extensionSchema }),
        outputSchema: z.strictObject({ extension: storedExtensionSchema.nullable() }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      },
      ({ id: extensionId, expectedRevision, extension }) =>
        respond(
          async () => ({ extension: await extensions.update(extensionId, expectedRevision, extension) }),
          '拡張更新に失敗しました。revision競合は最新詳細を再取得して確認し、保存失敗時は内容を上書きせず保存先を確認してください。',
        ),
    );
    server.registerTool(
      'delete_extension',
      {
        description: '現在のrevisionを指定して登録指示を削除します。revisionが変わっていたら競合として拒否します。',
        inputSchema: z.strictObject({ id, expectedRevision: revision }),
        outputSchema: z.strictObject({ deleted: z.boolean() }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      },
      ({ id: extensionId, expectedRevision }) =>
        respond(
          async () => ({ deleted: await extensions.delete(extensionId, expectedRevision) }),
          '拡張削除に失敗しました。revision競合を最新詳細で確認し、保存データを推測して置き換えないでください。',
        ),
    );
  }
  return server;
}
