import { NextRequest, NextResponse } from 'next/server'

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="FinTrack"',
      'Cache-Control': 'no-store',
    },
  })
}

function parseBasicAuth(header: string | null): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null

  try {
    const decoded = atob(header.slice('Basic '.length))
    const separator = decoded.indexOf(':')
    if (separator < 0) return null

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    }
  } catch {
    return null
  }
}

export function middleware(req: NextRequest): NextResponse {
  const expectedPassword = process.env.FINTRACK_PASSWORD
  if (!expectedPassword) return NextResponse.next()

  const expectedUsername = process.env.FINTRACK_USERNAME ?? 'fintrack'
  const credentials = parseBasicAuth(req.headers.get('authorization'))

  if (
    credentials?.username !== expectedUsername ||
    credentials.password !== expectedPassword
  ) {
    return unauthorized()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon-192x192.png|icon-512x512.png|manifest.json|manifest.webmanifest|sw.js).*)',
  ],
}
