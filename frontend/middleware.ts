import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

// Routes that require authentication
const PROTECTED_ROUTES = ['/portfolio', '/paper-trading', '/onboarding']

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some((route) => pathname.startsWith(route))
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  // Refresh session (important for keeping cookies fresh)
  const { data: { session } } = await (supabase.auth as any).getSession()

  // Only protect specific routes — public pages (screener, stock, home) work without auth
  if (isProtectedRoute(request.nextUrl.pathname)) {
    if (!session?.user) {
      const url = request.nextUrl.clone()
      url.pathname = '/auth/login'
      url.searchParams.set('next', request.nextUrl.pathname)
      return NextResponse.redirect(url)
    }

    // If user is going to onboarding but already done, redirect to screener
    if (request.nextUrl.pathname.startsWith('/onboarding')) {
      // We can't check profile here easily, so let the page handle it
    }
  }

  // If logged-in user visits auth pages, redirect to screener
  if (
    session?.user &&
    (request.nextUrl.pathname.startsWith('/auth/login') ||
      request.nextUrl.pathname.startsWith('/auth/signup'))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/screener'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}