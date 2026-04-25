"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  CategoryTile,
  PlusIcon,
  MicIcon,
  EditIcon,
  TrashIcon,
  SearchIcon,
  DownloadIcon,
  SortIcon,
  ChevronIcon,
} from "@/components/icons";
import { AnimatedNumber } from "@/components/shared/AnimatedNumber";
import { CATEGORIES } from "@/data/categories";
import { SAMPLE_EXPENSES, CURRENT } from "@/data/sampleExpenses";
import { formatMoney, MONTH_NAMES, WEEKDAYS_SHORT, cn } from "@/lib/utils";
import type { Expense, CategoryKey } from "@/types";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

type TimeRange = "day" | "week" | "month";
type FilterId = "all" | "voice" | "fixed" | CategoryKey;

interface FilterDef {
  id: FilterId;
  label: string;
  count: number;
  icon?: React.ReactNode;
}

// ═══════════════════════════════════════════════════════════════
// Time Range Segmented Control
// ═══════════════════════════════════════════════════════════════

function TimeRangeSegment({
  value,
  onChange,
  isCurrentMonth,
}: {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
  isCurrentMonth: boolean;
}) {
  // Past months: only "Month" makes sense (no "today" or "this week")
  const options: { key: TimeRange; label: string }[] = isCurrentMonth
    ? [
        { key: "day", label: "Day" },
        { key: "week", label: "Week" },
        { key: "month", label: "Month" },
      ]
    : [{ key: "month", label: "Month" }];

  return (
    <div className="inline-flex bg-bg-2 p-[3px] rounded-full gap-[2px]">
      {options.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            "h-[30px] px-[14px] rounded-full text-xs font-medium cursor-pointer transition-all",
            value === key
              ? "bg-white text-ink-0 shadow-sm"
              : "bg-transparent text-ink-1 hover:text-ink-0",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Filter Chips with dynamic counts
// ═══════════════════════════════════════════════════════════════

function FilterChips({
  value,
  onChange,
  filters,
}: {
  value: FilterId;
  onChange: (v: FilterId) => void;
  filters: FilterDef[];
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto mobile-h-scroll pb-1">
      {filters.map((f) => {
        const isActive = value === f.id;
        const isDisabled = f.count === 0 && f.id !== "all";

        return (
          <button
            key={f.id}
            onClick={() => !isDisabled && onChange(f.id)}
            disabled={isDisabled}
            className={cn(
              "h-8 px-3.5 rounded-full flex-shrink-0",
              "inline-flex items-center gap-1.5",
              "text-xs font-medium transition-all",
              isDisabled ? "cursor-not-allowed" : "cursor-pointer",
            )}
            style={{
              background: isActive
                ? "linear-gradient(135deg, oklch(0.96 0.06 92), oklch(0.88 0.12 88))"
                : "#fff",
              border: isActive
                ? "1px solid oklch(0.80 0.12 88)"
                : "1px solid var(--color-line-soft)",
              color: isActive ? "var(--color-gold-900)" : "var(--color-ink-1)",
              boxShadow: isActive ? "var(--shadow-sm)" : "none",
              opacity: isDisabled ? 0.4 : 1,
            }}
          >
            {f.icon}
            <span>{f.label}</span>
            <span
              className="mono text-[10px]"
              style={{
                color: isActive
                  ? "var(--color-gold-700)"
                  : "var(--color-ink-3)",
              }}
            >
              {f.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Day Card
// ═══════════════════════════════════════════════════════════════

function DayCard({
  day,
  entries,
  index,
}: {
  day: number;
  entries: Expense[];
  index: number;
}) {
  const dayTotal = entries.reduce((a, b) => a + b.amt, 0);
  const voiceCount = entries.filter((e) => e.voice).length;
  const date = new Date(CURRENT.year, CURRENT.month - 1, day);
  const weekday = WEEKDAYS_SHORT[date.getDay()];
  const isToday = day === CURRENT.day;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: 0.15 + index * 0.04,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="rounded-[20px] bg-white overflow-hidden"
      style={{ border: "1px solid var(--color-line-soft)" }}
    >
      {/* Day header (clickable → Daily Detail) */}
      <Link
        href={`/ledger/${day}`}
        className="block"
        style={{
          background: isToday
            ? "linear-gradient(90deg, oklch(0.97 0.04 92), #fff 50%)"
            : "var(--color-bg-1)",
          borderBottom: "1px solid var(--color-line-soft)",
        }}
      >
        <div className="flex items-center gap-3 md:gap-4 px-4 md:px-5 py-3 md:py-3.5 hover:bg-black/[0.02] transition-colors cursor-pointer">
          <div className="flex items-baseline gap-2 md:gap-3 flex-wrap">
            <div
              className="display"
              style={{ fontSize: "clamp(20px, 2.5vw, 26px)", lineHeight: 1 }}
            >
              Apr {day}
            </div>
            <div className="text-[11px] md:text-xs text-ink-2 uppercase tracking-[0.08em] font-medium">
              {weekday}
            </div>
            {isToday && (
              <span
                className="chip"
                style={{
                  background: "oklch(0.96 0.06 92)",
                  color: "var(--color-gold-900)",
                  borderColor: "oklch(0.85 0.10 88)",
                }}
              >
                Today
              </span>
            )}
          </div>

          <div className="flex-1" />

          <div className="hidden sm:flex gap-3 text-[11px] text-ink-2">
            <span>{entries.length} entries</span>
            {voiceCount > 0 && (
              <span className="text-gold-700 inline-flex items-center gap-1">
                <MicIcon size={10} className="text-gold-700" />
                {voiceCount} voice
              </span>
            )}
          </div>

          <div className="mono text-sm md:text-base font-semibold whitespace-nowrap">
            −{formatMoney(dayTotal)}
          </div>

          <ChevronIcon
            direction="right"
            size={14}
            className="text-ink-3 hidden md:block"
          />
        </div>
      </Link>

      {/* Desktop table */}
      <div className="hidden md:block">
        <table className="tbl w-full" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 80 }} />
            <col style={{ width: 180 }} />
            <col />
            <col style={{ width: 150 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 80 }} />
          </colgroup>
          <tbody>
            {entries.map((t) => (
              <tr key={t.id} className="group cursor-pointer">
                <td className="mono text-xs text-ink-2">{t.time}</td>
                <td>
                  <div className="flex items-center gap-2.5">
                    <CategoryTile kind={t.cat} size={28} variant="filled" />
                    <span className="font-medium text-[13px]">
                      {CATEGORIES[t.cat].label}
                    </span>
                  </div>
                </td>
                <td className="text-[13px]">
                  <span className="truncate block">{t.note}</span>
                </td>
                <td>
                  <div className="flex gap-1 flex-wrap">
                    {t.voice && (
                      <span
                        className="chip"
                        style={{
                          background: "oklch(0.96 0.04 92)",
                          color: "var(--color-gold-900)",
                          height: 22,
                          fontSize: 10,
                        }}
                      >
                        <MicIcon size={9} className="text-gold-700" />
                        voice
                      </span>
                    )}
                    {t.fixed && (
                      <span
                        className="chip"
                        style={{ height: 22, fontSize: 10 }}
                      >
                        fixed
                      </span>
                    )}
                  </div>
                </td>
                <td
                  className="mono text-right font-semibold text-sm"
                  style={{ whiteSpace: "nowrap" }}
                >
                  −{formatMoney(t.amt)}
                </td>
                <td>
                  <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-bg-2 transition-colors"
                      aria-label="Edit"
                    >
                      <EditIcon size={12} className="text-ink-2" />
                    </button>
                    <button
                      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-bg-2 transition-colors"
                      aria-label="Delete"
                    >
                      <TrashIcon size={12} className="text-ink-2" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile list */}
      <div className="md:hidden divide-y divide-line-soft">
        {entries.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2.5 px-4 py-3 active:bg-bg-1"
          >
            <CategoryTile kind={t.cat} size={32} variant="filled" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium truncate">{t.note}</div>
              <div className="text-[10px] text-ink-2 mt-0.5 flex items-center gap-1">
                {t.voice && (
                  <>
                    <span className="text-gold-700 inline-flex items-center gap-0.5">
                      <MicIcon size={9} className="text-gold-700" />
                      voice
                    </span>
                    <span>·</span>
                  </>
                )}
                {t.fixed && (
                  <>
                    <span>fixed</span>
                    <span>·</span>
                  </>
                )}
                <span className="mono">{t.time}</span>
              </div>
            </div>
            <div className="mono text-[13px] font-semibold whitespace-nowrap">
              −{formatMoney(t.amt)}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Period Total Card
// ═══════════════════════════════════════════════════════════════

function PeriodTotalCard({
  filter,
  range,
  total,
  filterLabel,
}: {
  filter: FilterId;
  range: TimeRange;
  total: number;
  filterLabel: string;
}) {
  const rangeLabel =
    range === "day"
      ? "today"
      : range === "week"
        ? "this week"
        : `${MONTH_NAMES[CURRENT.month - 1]} ${CURRENT.year}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-[16px] px-5 py-4 flex items-center gap-4"
      style={{
        background: "linear-gradient(135deg, oklch(0.97 0.04 92), #fff)",
        border: "1px solid oklch(0.88 0.08 88)",
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-gold-900 uppercase tracking-[0.14em] font-semibold">
          Period total
        </div>
        <div className="text-[11px] md:text-xs text-ink-2 mt-0.5 truncate">
          {filter === "all" ? "All categories" : filterLabel} · {rangeLabel}
        </div>
      </div>
      <div
        className="mono font-semibold text-ink-0 whitespace-nowrap"
        style={{ fontSize: "clamp(16px, 2vw, 20px)" }}
      >
        −<AnimatedNumber value={total} format="money" duration={1200} />
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Ledger Page
// ═══════════════════════════════════════════════════════════════

export default function LedgerPage() {
  const [range, setRange] = useState<TimeRange>("month");
  const [filter, setFilter] = useState<FilterId>("all");

  const monthName = MONTH_NAMES[CURRENT.month - 1];

  // For now, we always view current month.
  // TODO Phase 4: This will become URL-based and respect TopBar month selection.
  const isCurrentMonth = true;

  // ═══════════════════════════════════════════════════════════
  // QUICK FIX 1: Filter expenses by time range first (base set)
  // The filter chips will count from THIS base set
  // ═══════════════════════════════════════════════════════════
  const baseExpensesForRange = useMemo(() => {
    let result = SAMPLE_EXPENSES;

    if (range === "day") {
      result = result.filter((t) => t.day === CURRENT.day);
    } else if (range === "week") {
      const todayDate = new Date(CURRENT.year, CURRENT.month - 1, CURRENT.day);
      const todayDow = todayDate.getDay();
      const weekStart = CURRENT.day - todayDow;
      const weekEnd = weekStart + 6;
      result = result.filter((t) => t.day >= weekStart && t.day <= weekEnd);
    }
    // 'month' - no time filter

    return result;
  }, [range]);

  // ═══════════════════════════════════════════════════════════
  // QUICK FIX 1: Counts now reflect the time-range base
  // ═══════════════════════════════════════════════════════════
  const filters: FilterDef[] = useMemo(() => {
    const countCat = (cat: CategoryKey) =>
      baseExpensesForRange.filter((t) => t.cat === cat).length;

    return [
      { id: "all", label: "All", count: baseExpensesForRange.length },
      {
        id: "voice",
        label: "Voice",
        count: baseExpensesForRange.filter((t) => t.voice).length,
        icon: <MicIcon size={11} />,
      },
      {
        id: "fixed",
        label: "Fixed",
        count: baseExpensesForRange.filter((t) => t.fixed).length,
      },
      { id: "food", label: "Food", count: countCat("food") },
      { id: "shop", label: "Shopping", count: countCat("shop") },
      { id: "trans", label: "Transport", count: countCat("trans") },
      { id: "bills", label: "Bills", count: countCat("bills") },
      { id: "ent", label: "Entertainment", count: countCat("ent") },
      { id: "health", label: "Health", count: countCat("health") },
    ];
  }, [baseExpensesForRange]);

  // ═══════════════════════════════════════════════════════════
  // QUICK FIX 3: Derive the *effective* filter — if user-selected
  // filter has 0 count in current range, fall back to 'all' for display.
  // No useEffect needed (no cascading renders, React 19 best practice).
  // ═══════════════════════════════════════════════════════════
  const effectiveFilter: FilterId = useMemo(() => {
    if (filter === "all") return "all";
    const currentFilter = filters.find((f) => f.id === filter);
    if (currentFilter && currentFilter.count === 0) {
      return "all"; // Fallback — but don't mutate user's actual choice
    }
    return filter;
  }, [filter, filters]);

  // Apply filter on top of base (use effectiveFilter, not raw filter)
  const filteredExpenses = useMemo(() => {
    if (effectiveFilter === "all") return baseExpensesForRange;
    if (effectiveFilter === "voice")
      return baseExpensesForRange.filter((t) => t.voice);
    if (effectiveFilter === "fixed")
      return baseExpensesForRange.filter((t) => t.fixed);
    return baseExpensesForRange.filter((t) => t.cat === effectiveFilter);
  }, [baseExpensesForRange, effectiveFilter]);

  // Group by day
  const expensesByDay = useMemo(() => {
    const map: Record<number, Expense[]> = {};
    filteredExpenses.forEach((t) => {
      if (!map[t.day]) map[t.day] = [];
      map[t.day].push(t);
    });
    Object.keys(map).forEach((d) => {
      map[Number(d)].sort((a, b) => b.time.localeCompare(a.time));
    });
    return map;
  }, [filteredExpenses]);

  const sortedDays = Object.keys(expensesByDay)
    .map(Number)
    .sort((a, b) => b - a);

  const rangeTotal = filteredExpenses.reduce((a, b) => a + b.amt, 0);
  const filterLabel =
    filters.find((f) => f.id === effectiveFilter)?.label ?? "All";

  const rangeDisplay =
    range === "day"
      ? "Today"
      : range === "week"
        ? "This week"
        : `${monthName} ${CURRENT.year}`;

  return (
    <div className="px-4 md:px-8 py-5 md:py-7 pb-16 max-w-[1320px] mx-auto flex flex-col gap-5 md:gap-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col md:flex-row md:items-end gap-3"
      >
        <div className="flex-1 min-w-0">
          <div className="text-[10px] md:text-[11px] text-gold-900 uppercase tracking-[0.14em] font-semibold">
            Ledger · {rangeDisplay}
          </div>
          <h1
            className="display mt-0.5 md:mt-1"
            style={{ fontSize: "clamp(28px, 5vw, 44px)", lineHeight: 1.05 }}
          >
            {filteredExpenses.length}{" "}
            <span className="text-ink-2 font-medium">
              {filteredExpenses.length === 1 ? "entry" : "entries"}
            </span>{" "}
            <span style={{ color: "var(--color-gold-700)" }}>
              · −
              <AnimatedNumber
                value={rangeTotal}
                format="money"
                duration={1200}
              />
            </span>
          </h1>
          <div className="text-[12px] md:text-[13px] text-ink-2 mt-1">
            Exports to .xlsx / .csv · bulk edit supported
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <TimeRangeSegment
            value={range}
            onChange={setRange}
            isCurrentMonth={isCurrentMonth}
          />

          <button
            className="h-10 px-3 md:px-4 rounded-full border border-line bg-white text-sm font-medium hover:border-ink-2 flex items-center gap-2 transition-all"
            aria-label="Export"
          >
            <DownloadIcon size={14} />
            <span className="hidden sm:inline">Export</span>
          </button>

          <button
            className="h-10 px-4 md:px-5 rounded-full text-sm font-semibold flex items-center gap-2 transition-all hover:brightness-[1.03] hover:scale-[1.02]"
            style={{
              background:
                "linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))",
              color: "#1a120a",
              boxShadow: "var(--shadow-gold)",
              border: "1px solid oklch(0.85 0.14 88)",
            }}
          >
            <PlusIcon size={16} />
            <span>Add row</span>
          </button>
        </div>
      </motion.div>

      {/* Filter + Utility row */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="flex items-center gap-2 flex-wrap"
      >
        <div className="flex-1 min-w-0">
          <FilterChips
            value={effectiveFilter}
            onChange={setFilter}
            filters={filters}
          />
        </div>

        <div className="hidden md:flex gap-2 flex-shrink-0">
          <button
            className="h-8 px-3 rounded-full text-xs font-medium text-ink-1 hover:bg-bg-2 inline-flex items-center gap-1.5 transition-colors"
            aria-label="Search"
          >
            <SearchIcon size={13} />
            <span>Search</span>
          </button>
          <button
            className="h-8 px-3 rounded-full text-xs font-medium text-ink-1 hover:bg-bg-2 inline-flex items-center gap-1.5 transition-colors"
            aria-label="Sort"
          >
            <SortIcon size={13} />
            <span>Date ↓</span>
          </button>
        </div>
      </motion.div>

      {/* Day-grouped list */}
      {sortedDays.length > 0 ? (
        <div className="flex flex-col gap-3 md:gap-3.5">
          {sortedDays.map((day, i) => (
            <DayCard
              key={day}
              day={day}
              entries={expensesByDay[day]}
              index={i}
            />
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-[20px] bg-white p-12 text-center"
          style={{ border: "1px solid var(--color-line-soft)" }}
        >
          <div className="text-ink-2 text-sm">
            No entries match this filter.
          </div>
          <button
            onClick={() => {
              setFilter("all");
              setRange("month");
            }}
            className="mt-3 text-gold-700 text-sm font-medium hover:text-gold-900 transition-colors"
          >
            Clear filters
          </button>
        </motion.div>
      )}

      {/* Period Total */}
      {sortedDays.length > 0 && (
        <PeriodTotalCard
          filter={effectiveFilter}
          range={range}
          total={rangeTotal}
          filterLabel={filterLabel}
        />
      )}
    </div>
  );
}
