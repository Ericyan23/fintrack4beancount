export function fakeSimpleFinAccessUrl(input: {
  username?: string
  password?: string
  host?: string
  path?: string
} = {}): string {
  const url = new URL(`https://${input.host ?? 'simplefin.example.test'}${input.path ?? '/access'}`)
  url.username = input.username ?? 'fixture-user'
  url.password = input.password ?? 'fixture-pass'
  return url.toString()
}
