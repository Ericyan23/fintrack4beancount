import type {
  SimpleFinAccountPayload,
  SimpleFinPayload,
  SimpleFinTransactionPayload,
} from '@/lib/ingest/simplefin'

export type SimpleFINTransaction = SimpleFinTransactionPayload
export type SimpleFINAccount = SimpleFinAccountPayload
export type SimpleFINPayload = SimpleFinPayload

export interface FetchSimpleFINPayloadOptions {
  startDate: number
  pending?: boolean
  version?: number
  fetchImpl?: typeof fetch
}

export class SimpleFINAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SimpleFINAdapterError'
  }
}

export async function fetchSimpleFINPayload(
  accessUrl: string,
  options: FetchSimpleFINPayloadOptions,
): Promise<SimpleFINPayload> {
  const parsedUrl = parseAccessUrl(accessUrl)
  const fetchImpl = options.fetchImpl ?? fetch
  const version = options.version ?? 2
  const pending = options.pending ?? true
  const accountsUrl = buildAccountsUrl(parsedUrl, version, options.startDate, pending)
  const auth = Buffer.from(
    `${decodeCredentialPart(parsedUrl.username)}:${decodeCredentialPart(parsedUrl.password)}`,
  ).toString('base64')

  let response: Response
  try {
    response = await fetchImpl(accountsUrl, {
      headers: { Authorization: `Basic ${auth}` },
    })
  } catch (err) {
    throw new SimpleFINAdapterError(toSafeFetchErrorMessage(err))
  }

  if (!response.ok) {
    throw new SimpleFINAdapterError(
      `SimpleFIN request failed with HTTP ${response.status} ${response.statusText}`.trim(),
    )
  }

  try {
    return (await response.json()) as SimpleFINPayload
  } catch {
    throw new SimpleFINAdapterError('SimpleFIN response was not valid JSON')
  }
}

function parseAccessUrl(accessUrl: string): URL {
  try {
    return new URL(accessUrl)
  } catch {
    throw new SimpleFINAdapterError('Invalid SimpleFIN access URL')
  }
}

function buildAccountsUrl(
  accessUrl: URL,
  version: number,
  startDate: number,
  pending: boolean,
): string {
  const accountsUrl = new URL(`${accessUrl.protocol}//${accessUrl.host}${accessUrl.pathname}`)
  accountsUrl.pathname = `${accountsUrl.pathname.replace(/\/$/, '')}/accounts`
  accountsUrl.searchParams.set('version', String(version))
  accountsUrl.searchParams.set('start-date', String(startDate))
  accountsUrl.searchParams.set('pending', pending ? '1' : '0')
  return accountsUrl.toString()
}

function decodeCredentialPart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function toSafeFetchErrorMessage(err: unknown): string {
  void err
  return 'SimpleFIN request failed'
}
