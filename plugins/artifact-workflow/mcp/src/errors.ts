/** 保存処理が定義する失敗理由。OS由来のコードはこの型に含めず、そのまま伝播させる。 */
export type StoreErrorCode =
  | 'INVALID_DIRECTORY'
  | 'INVALID_DATA'
  | 'NOT_INITIALIZED'
  | 'REVISION_CONFLICT'
  | 'SESSION_COMPLETED'
  | 'PLAN_NOT_SAVED'
  | 'SESSION_BUSY'
  | 'PLAN_TOO_LARGE';

/** 失敗理由だけを保持し、MCPツールの操作案内は応答側で付ける。 */
export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

export function systemErrorCode(error: unknown): string | undefined {
  return error instanceof Error && !(error instanceof StoreError) && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}
