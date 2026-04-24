// import { CategoryIcon, CategoryTile } from '@/components/icons';
// import { CATEGORIES } from '@/data/categories';
// import { SAMPLE_EXPENSES, TOTAL_SPENT } from '@/data/sampleExpenses';
// import { formatMoney } from '@/lib/utils';
// import type { CategoryKey } from '@/types';

// export default function Home() {
//   const categories = Object.keys(CATEGORIES) as CategoryKey[];
//   const recentExpenses = SAMPLE_EXPENSES.slice(0, 5);

//   return (
//     <main className="min-h-screen relative overflow-hidden">
//       {/* ─── Ambient background orbs ─── */}
//       <div className="absolute inset-0 overflow-hidden pointer-events-none">
//         <div className="orb orb-1" style={{ left: '-10%', top: '-8%', width: 360, height: 360 }} />
//         <div className="orb orb-2" style={{ right: '-5%', top: '10%', width: 280, height: 280 }} />
//         <div className="orb orb-1" style={{ left: '30%', bottom: '-10%', width: 320, height: 320, opacity: 0.3 }} />
//       </div>

//       {/* ─── Content ─── */}
//       <div className="relative z-10 max-w-6xl mx-auto px-8 py-16">
//         {/* Header */}
//         <header className="mb-16 fade-up">
//           <div className="text-xs uppercase tracking-[0.2em] text-gold-700 font-semibold mb-3">
//             🍯 Honey · Design System Preview
//           </div>
//           <h1 className="serif text-6xl text-ink-0 mb-4">
//             Welcome to Honey
//           </h1>
//           <p className="text-ink-2 text-lg max-w-2xl">
//             AI-powered expense tracking. This page is just a design system check
//             — verifying fonts, colors, icons, and animations all work correctly.
//           </p>
//         </header>

//         {/* Stats card showcase */}
//         <section className="mb-12 fade-up" style={{ animationDelay: '0.1s' }}>
//           <div className="glass rounded-2xl p-8 max-w-md">
//             <div className="text-xs uppercase tracking-[0.1em] text-ink-2 mb-2">
//               Total spent this month
//             </div>
//             <div className="serif text-5xl text-ink-0 mb-1">
//               {formatMoney(TOTAL_SPENT)}
//             </div>
//             <div className="text-sm text-ink-2">
//               of S$3,500 budget · {SAMPLE_EXPENSES.length} transactions
//             </div>
//           </div>
//         </section>

//         {/* Category icons showcase - 3 variants */}
//         <section className="mb-12 fade-up" style={{ animationDelay: '0.2s' }}>
//           <h2 className="serif text-2xl text-ink-0 mb-6">Category Icons</h2>

//           <div className="space-y-6">
//             {(['filled', 'outline', '3d'] as const).map((variant) => (
//               <div key={variant}>
//                 <div className="text-xs uppercase tracking-[0.1em] text-ink-2 mb-3">
//                   Variant: {variant}
//                 </div>
//                 <div className="flex gap-4 flex-wrap">
//                   {categories.map((kind) => (
//                     <div key={kind} className="flex flex-col items-center gap-2">
//                       <CategoryTile kind={kind} variant={variant} size={56} />
//                       <span className="text-xs text-ink-2">{CATEGORIES[kind].label}</span>
//                     </div>
//                   ))}
//                 </div>
//               </div>
//             ))}
//           </div>
//         </section>

//         {/* Recent expenses */}
//         <section className="mb-12 fade-up" style={{ animationDelay: '0.3s' }}>
//           <h2 className="serif text-2xl text-ink-0 mb-6">Recent Expenses</h2>
//           <div className="bg-bg-card rounded-xl shadow-md overflow-hidden">
//             {recentExpenses.map((expense, i) => (
//               <div
//                 key={expense.id}
//                 className={`flex items-center gap-4 p-4 ${i !== recentExpenses.length - 1 ? 'border-b border-line-soft' : ''
//                   }`}
//               >
//                 <CategoryTile kind={expense.cat} size={44} />
//                 <div className="flex-1 min-w-0">
//                   <div className="font-medium text-ink-0 truncate">{expense.note}</div>
//                   <div className="text-xs text-ink-2 mt-0.5">
//                     Day {expense.day} · {expense.time}
//                     {expense.voice && ' · 🎤'}
//                   </div>
//                 </div>
//                 <div className="mono text-right">
//                   <div className="text-ink-0 font-medium">{formatMoney(expense.amt)}</div>
//                 </div>
//               </div>
//             ))}
//           </div>
//         </section>

//         {/* Color swatches */}
//         <section className="mb-12 fade-up" style={{ animationDelay: '0.4s' }}>
//           <h2 className="serif text-2xl text-ink-0 mb-6">Gold Palette</h2>
//           <div className="flex gap-2">
//             {[50, 100, 200, 300, 400, 500, 600, 700, 900].map((shade) => (
//               <div key={shade} className="flex-1">
//                 <div
//                   className={`h-20 rounded-lg shadow-sm bg-gold-${shade}`}
//                 />
//                 <div className="text-xs text-ink-2 mt-2 text-center mono">
//                   {shade}
//                 </div>
//               </div>
//             ))}
//           </div>
//         </section>

//         {/* Buttons */}
//         <section className="mb-12 fade-up" style={{ animationDelay: '0.5s' }}>
//           <h2 className="serif text-2xl text-ink-0 mb-6">Buttons</h2>
//           <div className="flex gap-3 flex-wrap">
//             <button className="grad-gold text-ink-0 font-medium px-6 py-3 rounded-full shadow-gold hover:brightness-105 transition-all">
//               ✨ Primary Action
//             </button>
//             <button className="bg-bg-card border border-line text-ink-0 font-medium px-6 py-3 rounded-full hover:border-ink-2 transition-all">
//               Secondary
//             </button>
//             <button className="bg-transparent text-ink-1 font-medium px-6 py-3 rounded-full hover:bg-bg-2 transition-all">
//               Ghost
//             </button>
//           </div>
//         </section>

//         {/* Footer note */}
//         <footer className="mt-20 text-center text-ink-3 text-sm">
//           ✓ Design system loaded · Phase 2: Dashboard 🚀
//         </footer>
//       </div>
//     </main>
//   );
// }

import { redirect } from 'next/navigation';

export default function Home() {
  // Temporary: redirect to dashboard until landing page is built (Phase 8)
  redirect('/dashboard');
}