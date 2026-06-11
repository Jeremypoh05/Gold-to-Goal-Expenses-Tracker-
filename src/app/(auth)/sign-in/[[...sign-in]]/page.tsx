// ADDED (Phase 7 · Auth): Clerk sign-in (optional catch-all handles factor steps).
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
    return <SignIn />;
}
