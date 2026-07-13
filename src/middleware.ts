import { auth } from "@/auth";
import { updateSession } from "@/utils/supabase/middleware";
import { NextResponse } from "next/server";

export default auth(async (req) => {
  const supabaseResponse = await updateSession(req);

  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return supabaseResponse;
});

export const config = {
  matcher: ["/((?!api/dev/seed|api|_next/static|_next/image|favicon.ico).*)"],
};
