import type { Category, CategoryKey } from "@/types";

export const CATEGORIES: Record<CategoryKey, Category> = {
  food: { key: "food", label: "Food", color: "var(--color-hue-food)", hue: 40 },
  shop: {
    key: "shop",
    label: "Shopping",
    color: "var(--color-hue-shop)",
    hue: 340,
  },
  ent: {
    key: "ent",
    label: "Entertainment",
    color: "var(--color-hue-ent)",
    hue: 300,
  },
  trans: {
    key: "trans",
    label: "Transport",
    color: "var(--color-hue-trans)",
    hue: 220,
  },
  health: {
    key: "health",
    label: "Health",
    color: "var(--color-hue-health)",
    hue: 160,
  },
  bills: {
    key: "bills",
    label: "Fixed bills",
    color: "var(--color-hue-bills)",
    hue: 260,
  },
  other: {
    key: "other",
    label: "Others",
    color: "var(--color-hue-other)",
    hue: 80,
  },
};
