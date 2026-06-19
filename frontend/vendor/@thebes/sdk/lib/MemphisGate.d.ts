/**
 * MemphisGate — open-demo wrapper with Memphis passkey sign-in on demand.
 *
 * This is a public demo: anyone can roam the app without signing in. Memphis
 * passkey sign-in is offered in the header (SignOutChip) and prompted only when
 * a visitor wants a persistent identity. Sign-in attaches a human display name;
 * the on-chain caller is the boundary's persisted browser key either way, so
 * reads and writes work for guests too. Same API as every other Thebes example
 * (wrap routes in <MemphisGate>, read the session via useAuth(), sign in / out
 * via SignOutChip); the styling follows the host app's CSS tokens.
 */
import { type ReactNode } from 'react';
import { type MemphisAuth } from './useMemphis.js';
/** The Memphis session (signed in or guest). Throws if used outside the gate. */
export declare function useAuth(): MemphisAuth;
/** Open demo: always render the app. Sign-in is on demand via SignOutChip. */
export declare function MemphisGate({ children }: {
    appName?: string;
    tagline?: string;
    children: ReactNode;
}): import("react").JSX.Element;
/** Header auth control. Guests get a "Sign in" affordance; signed-in users see
 *  their name and a sign-out link. */
export declare function SignOutChip({ className }: {
    className?: string;
}): import("react").JSX.Element;
