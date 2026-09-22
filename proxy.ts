import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function redirectWithCookies(url: URL, response: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;
  const protectedRoutePrefix =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/vendor") ||
    pathname.startsWith("/admin") ||
    /^\/[^/]+\/(analytics|calls|settings)(\/|$)/.test(pathname);

  // Fail closed: if Supabase isn't configured we cannot verify sessions, so
  // protected routes must not be served rather than silently allowing access.
  if (!supabaseUrl || !supabaseKey) {
    if (protectedRoutePrefix) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }
    return response;
  }

  {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user && protectedRoutePrefix) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", request.nextUrl.pathname);
      return redirectWithCookies(url, response);
    }
    if (user && protectedRoutePrefix) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_admin")
        .eq("id", user.id)
        .maybeSingle();
      const url = request.nextUrl.clone();
      if (request.nextUrl.pathname.startsWith("/dashboard") && profile?.role === "vendor") {
        url.pathname = "/vendor";
        return redirectWithCookies(url, response);
      }
      if (request.nextUrl.pathname.startsWith("/vendor") && profile?.role !== "vendor" && profile?.role !== "admin") {
        url.pathname = "/dashboard";
        return redirectWithCookies(url, response);
      }
      if (request.nextUrl.pathname.startsWith("/admin") && !profile?.is_admin && profile?.role !== "admin") {
        url.pathname = profile?.role === "vendor" ? "/vendor" : "/dashboard";
        return redirectWithCookies(url, response);
      }
    }
  }

  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  const appHost = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL).hostname
    : null;

  if (!host || host === appHost || host === "localhost") {
    return response;
  }

  const domainResponse = await fetch(
    `${supabaseUrl}/rest/v1/organizations?select=slug&custom_domain=eq.${encodeURIComponent(host)}&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
  );
  if (!domainResponse.ok) return response;
  const organizations = (await domainResponse.json()) as Array<{ slug?: string }>;
  const orgSlug = organizations[0]?.slug;
  if (!orgSlug) return response;

  const url = request.nextUrl.clone();
  url.pathname = `/${orgSlug}${url.pathname === "/" ? "" : url.pathname}`;
  const rewrite = NextResponse.rewrite(url);
  for (const cookie of response.cookies.getAll()) {
    rewrite.cookies.set(cookie);
  }
  return rewrite;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and images.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
