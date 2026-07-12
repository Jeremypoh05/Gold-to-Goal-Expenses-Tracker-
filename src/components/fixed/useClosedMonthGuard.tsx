'use client';

// ADDED (Module 5.1): shared "your edit touches closed months" guard. Both edit
// entry points for a recurring rule — the in-place ledger/dashboard modal
// (FixedEditContext) and the Recurring page's own modal — call this before
// saving. If the rule's affected month range overlaps any hard-closed month, it
// asks how to handle those months.
//
// CHANGED (Module 5.1 · override): was a 2-button warn (proceed / cancel) that
// always kept closed months frozen. Now a 3-choice decision:
//   • "Update open months only"  → proceed, closed months stay frozen (default)
//   • "Also update {months}"     → proceed AND overwrite the closed months too
//   • "Cancel"                   → abort
// The caller threads `overrideClosed` into the server action so the closed-month
// freeze is lifted only for that specific, user-approved edit.

import { useChoice } from '@/components/shared';
import { fetchClosedMonths } from '@/lib/actions';
import { closedMonthsInRange } from '@/lib/expense-utils';
import { MONTH_NAMES } from '@/lib/utils';

interface Range {
    startYear: number;
    startMonth: number;
    endYear: number | null;
    endMonth: number | null;
}

export interface GuardResult {
    /** false = user cancelled; nothing should happen. */
    proceed: boolean;
    /** true = also rewrite the closed months in range (user chose to override). */
    overrideClosed: boolean;
}

const PROCEED_OPEN: GuardResult = { proceed: true, overrideClosed: false };

export function useClosedMonthGuard() {
    const choose = useChoice();

    /**
     * Ask how to handle closed months if [start..today] (capped at end) overlaps any.
     * `action` tailors the copy: 'edit' (redefine / rate change) vs 'delete' (remove
     * the rule). Returns { proceed, overrideClosed } — overrideClosed = also write /
     * delete the closed months.
     */
    return async function guardClosedMonths(
        range: Range,
        action: 'edit' | 'delete' | 'create' = 'edit',
    ): Promise<GuardResult> {
        const now = new Date();
        const closedList = await fetchClosedMonths();
        if (closedList.length === 0) return PROCEED_OPEN;

        const closedSet = new Set(closedList.map((c) => `${c.year}-${c.month}`));
        const hits = closedMonthsInRange(
            closedSet,
            range.startYear,
            range.startMonth,
            range.endYear,
            range.endMonth,
            now.getFullYear(),
            now.getMonth() + 1,
        );
        if (hits.length === 0) return PROCEED_OPEN;

        const one = hits.length === 1;
        const names = hits.map((h) => `${MONTH_NAMES[h.month - 1]} ${h.year}`).join(', ');

        if (action === 'create') {
            // A brand-new recurring rule: closed months in range don't get an entry
            // by default (their books are frozen). Offer to add into them anyway.
            const overrideLabel = one ? `Also add to ${names}` : `Also add to ${hits.length} closed months`;
            const picked = await choose({
                title: one ? 'The start range includes a closed month' : 'The start range includes closed months',
                message: (
                    <>
                        <b>{names}</b> {one ? 'is' : 'are'} closed, so by default the new recurring entry
                        <b> will not be added</b> there — only open months get it. You can also add it into
                        the closed {one ? 'month' : 'months'} anyway.
                    </>
                ),
                actions: [
                    { key: 'open', label: 'Add to open months only', tone: 'primary' },
                    { key: 'all', label: overrideLabel, tone: 'warn' },
                    { key: 'cancel', label: 'Cancel', tone: 'ghost' },
                ],
            });
            if (picked === 'open') return PROCEED_OPEN;
            if (picked === 'all') return { proceed: true, overrideClosed: true };
            return { proceed: false, overrideClosed: false };
        }

        if (action === 'delete') {
            const overrideLabel = one ? `Also delete ${names}` : `Also delete ${hits.length} closed months`;
            const picked = await choose({
                title: one ? 'A closed month has an entry' : 'Closed months have entries',
                message: (
                    <>
                        <b>{names}</b> {one ? 'is' : 'are'} closed. By default those recorded
                        {one ? ' entry is' : ' entries are'} <b>kept</b> when you delete this
                        recurring — open months are removed. You can also delete the closed
                        {one ? ' one' : ' ones'} too.
                    </>
                ),
                actions: [
                    { key: 'open', label: 'Delete rule · keep closed', tone: 'primary' },
                    { key: 'all', label: overrideLabel, tone: 'danger' },
                    { key: 'cancel', label: 'Cancel', tone: 'ghost' },
                ],
            });
            if (picked === 'open') return PROCEED_OPEN;
            if (picked === 'all') return { proceed: true, overrideClosed: true };
            return { proceed: false, overrideClosed: false };
        }

        // Keep the override button readable when many months are involved.
        const overrideLabel = one
            ? `Also update ${names}`
            : `Also update ${hits.length} closed months`;

        const picked = await choose({
            title: one ? 'This edit touches a closed month' : 'This edit touches closed months',
            message: (
                <>
                    <b>{names}</b> {one ? 'is' : 'are'} closed. By default closed months
                    <b> keep their recorded amount</b> — only open months change. You can
                    also apply this edit to {one ? 'it' : 'them'} anyway.
                </>
            ),
            actions: [
                { key: 'open', label: 'Update open months only', tone: 'primary' },
                { key: 'all', label: overrideLabel, tone: 'warn' },
                { key: 'cancel', label: 'Cancel', tone: 'ghost' },
            ],
        });

        if (picked === 'open') return PROCEED_OPEN;
        if (picked === 'all') return { proceed: true, overrideClosed: true };
        return { proceed: false, overrideClosed: false }; // cancel / dismissed
    };
}
