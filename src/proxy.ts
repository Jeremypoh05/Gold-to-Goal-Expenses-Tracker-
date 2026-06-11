// ADDED (Phase 7 · Auth): Clerk middleware.
// NOTE: on Next.js 16+ this file is `proxy.ts` (renamed from `middleware.ts`).
// Routes are public by default; we opt-in to protection for everything except
// the Clerk auth pages, so signed-out visitors are redirected to /sign-in.

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)']);

export default clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
        await auth.protect();
    }
});

export const config = {
    matcher: [
        // Skip Next internals and static files unless found in search params
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        // Always run for API routes
        '/(api|trpc)(.*)',
    ],
};
