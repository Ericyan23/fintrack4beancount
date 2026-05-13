export type SourceKind = 'simplefin' | 'csv' | 'manual' | 'legacy'
export type SourceStatus = 'active' | 'disabled'
export type SourceConnectionStatus = 'active' | 'disabled' | 'error'
export type ImportRunStatus = 'pending' | 'running' | 'completed' | 'failed'
export type RawImportItemStatus = 'pending' | 'staged' | 'ignored' | 'error'
export type StagedTransactionStatus = 'staged' | 'ready' | 'merged' | 'ignored' | 'error'
export type ImportProfileKind = 'csv' | 'simplefin' | 'ofx' | 'qif' | 'generic'
export type IngestionJsonObject = Record<string, unknown>
