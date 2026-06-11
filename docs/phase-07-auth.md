# Phase 7 — Authentication (Clerk)

A detailed, reproducible record of how auth was added to Honey, so you can understand
every step and re-do/extend it later.

- **Goal:** real user accounts, protected app, themed sign-in/up, and a real user replacing the
  hardcoded "Amelia Chan". No database yet — auth only gates the app and gives us the signed-in user.
- **Stack specifics:** Next.js 16 (App Router, `src/`), React 19, Clerk `@clerk/nextjs` v7,
  `@clerk/themes` for the dark base theme.
- **Outcome:** signed-out visitors are redirected to `/sign-in`; after sign-up they land on the
  dashboard with a one-time welcome; the sidebar/header show the real user with Manage account + Sign out.

---

## 0. Mental model (how Clerk fits)

- **`ClerkProvider`** wraps the React tree and gives every component the auth/session context.
- **Middleware** (`proxy.ts`) runs on every request *before* the page — that's where we decide which
  routes require a session.
- **Prebuilt components** do the heavy lifting so we never hand-roll auth UI or store passwords:
  `<SignIn/>`, `<SignUp/>`, `<UserButton/>`, and hooks `useUser()` / `useClerk()`.
- **Keys** live in environment variables. The `NEXT_PUBLIC_…` publishable key is safe in the client;
  the `CLERK_SECRET_KEY` is server-only and must never reach git.

---

## 1. Prerequisites (Clerk dashboard)

1. Create a Clerk application at clerk.com → it gives a **development** instance.
2. Copy the **Publishable key** (`pk_test_…`) and **Secret key** (`sk_test_…`).
3. (Optional) In the Clerk dashboard, enable the sign-in methods you want (Email, Google, etc.) —
   this is dashboard config, no code needed; the prebuilt `<SignIn/>` renders whatever is enabled.

> Dev keys (`pk_test_`/`sk_test_`) are for local development; production needs a production instance
> with `pk_live_`/`sk_live_`.

---

## 2. Install

```bash
npm install @clerk/nextjs @clerk/themes
```

`@clerk/nextjs` = the SDK; `@clerk/themes` = prebuilt appearance themes (we use `dark`).

---

## 3. Environment variables

**`.env.local`** (NEVER committed — `.env*` is already in `.gitignore`):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx

NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL=/dashboard?welcome=1
```

Also commit **`.env.example`** with the same keys but empty values, so collaborators know what to set.

- The `…SIGN_IN_URL` / `…SIGN_UP_URL` tell Clerk where our custom pages live.
- The `…FORCE_REDIRECT_URL`s decide where users go after auth (sign-up → `?welcome=1` powers the
  onboarding banner).

> **Security:** the secret key only ever sits in `.env.local`. Verify with `git check-ignore .env.local`.

---

## 4. Middleware — `src/proxy.ts`  ⚠️ Next.js 16 gotcha

On **Next.js 16+ the middleware file is `proxy.ts`** (renamed from `middleware.ts`; the code is
identical). It lives next to `app/` — here `src/proxy.ts`.

```ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect(); // redirects to /sign-in when no session
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
```

Key points:
- Routes are **public by default**; we *opt in* to protection. We invert it: everything except the
  Clerk pages is protected.
- `auth.protect()` issues the redirect to sign-in automatically.
- A successful build prints `ƒ Proxy (Middleware)` — confirmation the file is wired.

---

## 5. Themed provider — `src/components/auth/ClerkProviderThemed.tsx`

`ClerkProvider` must follow our light/dark toggle, so we render it from a client component that reads
our `useTheme()` and passes Clerk an `appearance`:

```tsx
'use client';
import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { useTheme } from '@/components/theme/ThemeProvider';

export function ClerkProviderThemed({ children }) {
  const { theme } = useTheme();
  return (
    <ClerkProvider appearance={{
      baseTheme: theme === 'dark' ? dark : undefined,
      variables: { colorPrimary: '#d8a43c', colorTextOnPrimaryBackground: '#1a120a',
                   borderRadius: '14px', fontFamily: 'var(--font-ui)' },
    }}>
      {children}
    </ClerkProvider>
  );
}
```

`colorPrimary` is a **hex** approximation of our gold (`--color-gold-500`) because Clerk's color
parser expects hex/rgb/hsl, not `oklch()`.

Wire it in **`src/app/layout.tsx`**, *inside* `ThemeProvider` (so `useTheme` exists):

```tsx
<ThemeProvider>
  <ClerkProviderThemed>{children}</ClerkProviderThemed>
</ThemeProvider>
```

---

## 6. Sign-in / Sign-up pages

Custom routes hosting Clerk's prebuilt widgets. We use a route group **`(auth)`** so they get their
own shell (no sidebar/topbar) while keeping clean URLs (`/sign-in`, `/sign-up`).

```
src/app/(auth)/layout.tsx                       ← centered Honey shell (Orbs + logo), dark-aware
src/app/(auth)/sign-in/[[...sign-in]]/page.tsx  ← export <SignIn />
src/app/(auth)/sign-up/[[...sign-up]]/page.tsx  ← export <SignUp />
```

The `[[...sign-in]]` **optional catch-all** is required so Clerk can render its multi-step flows
(verification, factors) under the same route.

---

## 7. Real user wiring (the bonus features)

- **Sidebar account** (`components/dashboard/Sidebar.tsx`): replaced the static user with
  `useUser()` (name/email) + `<UserButton/>` (Clerk's avatar menu) + an **explicit Sign-out button**
  (`useClerk().signOut({ redirectUrl: '/sign-in' })`). The explicit button matters because in dev the
  Next.js dev-tools button sits in the same bottom-left corner and can intercept the avatar click.
- **TopBar** (`components/dashboard/TopBar.tsx`): greeting uses `user?.firstName` (via `useGreeting`);
  the mobile-header avatar is a `<UserButton/>` (the mobile path to account, since the sidebar is
  desktop-only).
- **MoreSheet** (`components/dashboard/MoreSheet.tsx`): the "Settings" row now calls
  `useClerk().openUserProfile()` (was a disabled "Soon").
- **Onboarding** (`components/dashboard/WelcomeBanner.tsx`): a dismissible banner shown when
  `?welcome=1` is present (set by `SIGN_UP_FORCE_REDIRECT_URL`). It reads `useSearchParams()`, so it
  **must be wrapped in `<Suspense>`** by the dashboard page (Next requirement).

Reading the user anywhere:
- Client: `const { user } = useUser();` → `user.firstName`, `user.primaryEmailAddress?.emailAddress`,
  `user.imageUrl`.
- Server (later, Phase 8): `import { auth, currentUser } from '@clerk/nextjs/server'`.

---

## 8. Gotchas we hit (so you don't again)

1. **`proxy.ts`, not `middleware.ts`** on Next 16. (Verified against Clerk docs before coding.)
2. **`useSearchParams()` needs a `<Suspense>` boundary** or the build fails — wrap the banner.
3. **`oklch()` in Clerk `appearance.variables`** isn't supported → use hex for `colorPrimary`.
4. **Dev-tools overlap:** the Next.js dev indicator (the "N" with Route/Bundler/Preferences) is
   dev-only and lives bottom-left, overlapping the Clerk avatar — hence the explicit sign-out button.
5. **Secrets:** keep them in `.env.local`; commit only `.env.example`.

---

## 9. Verify

```bash
npm run lint && npx tsc --noEmit && npm run build   # build prints "ƒ Proxy (Middleware)"
npm run dev
```

- Visit any route signed out → redirected to **/sign-in** (themed, dark-aware).
- Sign up → `/dashboard?welcome=1` → welcome banner (gone on reload without the param).
- Sidebar shows real name/email; **Sign out** → back to sign-in.
- Toggle dark on the sign-in page + UserButton popover → follow the theme.

---

## 10. What's deferred to later phases

- **User-scoped data + persistence → Phase 8 (Neon + Prisma):** today the dashboard still shows shared
  sample data; Phase 8 ties rows to `userId` from Clerk (`auth()` server-side).
- **Role/Org protection** (`auth.protect({ role })`, `<Protect>`).
- **Landing page (Phase 10)** becomes the public entry for signed-out users instead of `/sign-in`.
