'use client';

// ADDED (Module 5.1): shared "your edit touches closed months" guard. Both edit
// entry points for a recurring rule — the in-place ledger/dashboard modal
// (FixedEditContext) and the Recurring page's own modal — call this before
// saving. If the rule's affected month range overlaps any hard-closed month, it
// warns (naming them) that those months keep their recorded amount, so the user
// isn't surprised by mismatched figures across months. Closed months always stay
// frozen; confirming just proceeds with the open months (the server enforces the
// freeze). Returns true = proceed, false = cancel.

import { useConfirm } from '@/components/shared';
import { fetchClosedMonths } from '@/lib/actions';
import { closedMonthsInRange } from '@/lib/expense-utils';
import { MONTH_NAMES } from '@/lib/utils';

interface Range {
    startYear: number;
    startMonth: number;
    endYear: number | null;
    endMonth: number | null;
}

export function useClosedMonthGuard() {
    const confirm = useConfirm();

    /** Warn if [start..today] (capped at end) overlaps closed months. */
    return async function guardClosedMonths(range: Range): Promise<boolean> {
        const now = new Date();
        const closedList = await fetchClosedMonths();
        if (closedList.length === 0) return true;

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
        if (hits.length === 0) return true;

        const names = hits.map((h) => `${MONTH_NAMES[h.month - 1]} ${h.year}`).join(', ');
        return confirm({
            title: 'This recurring has closed months',
            message: `${names} ${hits.length === 1 ? 'is' : 'are'} closed and will keep the recorded amount — only open months update. Reopen ${hits.length === 1 ? 'it' : 'them'} first if you want to change ${hits.length === 1 ? 'it' : 'them'} too.`,
            confirmLabel: 'Update open months',
            cancelLabel: 'Cancel',
        });
    };
}
