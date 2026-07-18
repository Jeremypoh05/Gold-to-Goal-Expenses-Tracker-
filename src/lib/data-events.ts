// ADDED (AI Assistant · Slice 2b): a tiny client-side "the data changed, re-fetch"
// bus. The problem it solves: every page reads its expenses/income/recurring from
// the client-side ExpensesProvider (a one-time server seed + in-place re-fetches).
// The AI assistant is a global slide-over layered OVER those pages — when it
// confirms a write (add/edit/delete expense, or edit a recurring rule), the server
// data changes but the visible page's client state doesn't, so nothing updates
// until a navigation/refresh. `router.refresh()` only re-runs SERVER components,
// not this client store.
//
// So after ANY confirmed write, the assistant calls notifyDataChanged(); the
// ExpensesProvider listens and re-fetches the viewed month, making the change
// reflect immediately across dashboard / ledger / calendar / income / recurring.
// A plain window Event keeps this dependency-free (no store/library) and decoupled
// — the emitter doesn't need a ref to the provider.

export const DATA_CHANGED_EVENT = "honey:data-changed";

/** Signal that underlying financial data changed, so live pages should re-fetch. */
export function notifyDataChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  }
}

// ADDED (2026-07-17): same bus for AI-quota state. Fired after every AI turn (usage
// moved) and whenever the fast-exhausted overflow choice changes (chat buttons or
// the Settings toggle) — so the Settings page's numbers and the chat/quick-mic
// usage strips stay in sync in real time, no refresh needed.
export const QUOTA_CHANGED_EVENT = "honey:quota-changed";

export function notifyQuotaChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(QUOTA_CHANGED_EVENT));
  }
}
