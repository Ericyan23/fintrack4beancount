export type SourceKind = 'simplefin' | 'csv' | 'manual' | 'legacy'
export type SourceStatus = 'active' | 'disabled'
export type SourceConnectionStatus = 'active' | 'disabled' | 'error'
export type ImportRunStatus = 'pending' | 'running' | 'completed' | 'failed'
export type RawImportItemStatus = 'pending' | 'staged' | 'ignored' | 'error'
export type StagedTransactionStatus = 'staged' | 'ready' | 'merged' | 'ignored' | 'error'
export type ImportProfileKind = 'csv' | 'simplefin' | 'ofx' | 'qif' | 'generic'
export type IngestionJsonObject = Record<string, unknown>
export type IngestionJsonValue =
  | string
  | number
  | boolean
  | null
  | IngestionJsonObject
  | IngestionJsonValue[]

export type MaybePromise<T> = T | Promise<T>

export type NormalizedAccountType =
  | 'depository'
  | 'credit'
  | 'investment'
  | 'loan'
  | 'other'

export type NormalizedTransactionStatus = 'pending' | 'posted' | 'cancelled'

export interface NormalizedBalance {
  sourceAccountId?: string
  externalAccountId?: string
  date: string
  amount: string
  currency?: string
  rawPayload?: IngestionJsonObject
}

export interface NormalizedAccount {
  sourceConnectionId?: string
  sourceAccountId?: string
  externalAccountId: string
  name: string
  currency?: string
  accountType?: NormalizedAccountType | string
  balance?: NormalizedBalance
  rawPayload?: IngestionJsonObject
}

export interface NormalizedTransactionUserFields {
  category?: string | null
  suggestedCategory?: string | null
  notes?: string | null
  tags?: string[] | null
}

export interface NormalizedTransaction {
  sourceConnectionId?: string
  sourceAccountId: string
  accountId?: string
  externalId?: string | null
  sourceItemKey: string
  date: string
  transactedAt?: string | null
  amount: string
  currency?: string
  description: string
  pending?: boolean
  status?: NormalizedTransactionStatus
  rawPayload: IngestionJsonObject
  normalizerVersion?: string
  userFields?: NormalizedTransactionUserFields
}

export interface RawSourceItem<TPayload = IngestionJsonObject> {
  sourceAccountId?: string | null
  externalId?: string | null
  rawPayload: TPayload
  receivedAt?: number | string | null
}

export interface RawImportRecord<TPayload = IngestionJsonObject> extends RawSourceItem<TPayload> {
  id?: string
  importRunId: string
  sourceItemKey: string
  contentHash?: string | null
  status: RawImportItemStatus
}

export interface StagedIngestionRecord {
  id?: string
  importRunId?: string | null
  rawItemId?: string | null
  sourceConnectionId?: string | null
  sourceAccountId?: string | null
  accountId?: string | null
  transactionId?: string | null
  sourceItemKey?: string | null
  transaction?: NormalizedTransaction
  validationErrors?: string[]
  status: StagedTransactionStatus
}

export interface SourceAdapterContext {
  sourceId: string
  sourceConnectionId: string
  importProfileId?: string | null
  config?: IngestionJsonObject
  cursor?: string | null
}

export interface SourceAdapterResult<TPayload = IngestionJsonObject> {
  accounts?: Array<RawSourceItem<TPayload>>
  transactions?: Array<RawSourceItem<TPayload>>
  balances?: Array<RawSourceItem<TPayload>>
  metadata?: IngestionJsonObject
  cursor?: string | null
}

export interface SourceAdapter<TPayload = IngestionJsonObject> {
  kind: SourceKind
  fetch(context: SourceAdapterContext): MaybePromise<SourceAdapterResult<TPayload>>
}

export interface NormalizerContext {
  sourceConnectionId: string
  normalizerVersion: string
}

export interface NormalizerResult {
  accounts?: NormalizedAccount[]
  transactions?: NormalizedTransaction[]
  balances?: NormalizedBalance[]
}

export interface Normalizer<TPayload = IngestionJsonObject> {
  version: string
  normalize(items: Array<RawImportRecord<TPayload>>, context: NormalizerContext): MaybePromise<NormalizerResult>
}

export interface StagingContext {
  importRunId: string
  sourceConnectionId: string
}

export interface Staging<TPayload = IngestionJsonObject> {
  stageRawItems(items: Array<RawSourceItem<TPayload>>, context: StagingContext): MaybePromise<Array<RawImportRecord<TPayload>>>
  stageTransactions(transactions: NormalizedTransaction[], context: StagingContext): MaybePromise<StagedIngestionRecord[]>
}

export interface PromoteContext {
  sourceConnectionId: string
  importRunId?: string | null
}

export interface PromoteResult {
  promoted: number
  skipped: number
  errors: string[]
}

export interface Promote {
  promote(staged: StagedIngestionRecord[], context: PromoteContext): MaybePromise<PromoteResult>
}

export interface EnrichContext {
  sourceConnectionId?: string
  importRunId?: string | null
}

export interface Enrich {
  enrich(staged: StagedIngestionRecord[], context: EnrichContext): MaybePromise<StagedIngestionRecord[]>
}

export interface ExportContext {
  accountIds?: string[]
  since?: string
  until?: string
}

export interface ExportResult {
  content: string
  exported: number
  errors: string[]
}

export interface Export {
  export(context: ExportContext): MaybePromise<ExportResult>
}
