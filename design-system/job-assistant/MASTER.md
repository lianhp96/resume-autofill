# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** 网申投递助手
**Generated:** 2026-08-31 20:27:25
**Category:** Job Board/Recruitment
**Design Dials:** Variance 4/10 (Balanced / Modern) | Motion 3/10 (Subtle) | Density 8/10 (Dense / Dashboard)

---

## Product Context & Implementation Decisions

- **Product type:** Local-first student recruitment productivity tool / job application tracker.
- **Primary pages:** Full dashboard, browser-action popup, and an injected quick-fill assistant.
- **Core user need:** Reduce cognitive load during a stressful, repetitive job-search workflow while keeping progress and next actions immediately scannable.
- **Visual direction:** Calm, trustworthy, content-first flat design. Blue communicates structure and focus; green is reserved for successful outcomes and primary completion actions.
- **Funnel interpretation:** The generated Funnel pattern maps to the application-stage pipeline and progressive form disclosure. It must not turn the dashboard into a marketing landing page.
- **Offline typography:** The extension must not fetch remote assets. Use `Lexend` and `Source Sans 3` when installed, then fall back to `Avenir Next`, `Segoe UI`, `PingFang SC`, `Microsoft YaHei`, and system sans-serif. Headings and metrics use the heading stack; body copy and controls use the body stack.
- **Icon policy:** Use text labels, numeric nav markers, or a single consistent inline SVG set. Never use emoji as interface icons.

### Layout Model

| Viewport | Layout |
|----------|--------|
| `>= 1280px` | Persistent 248px sidebar; five metric cards; records table plus 288px schedule rail |
| `900–1279px` | Persistent 224px sidebar; three-column metric grid; schedule moves below the table |
| `600–899px` | Compact top navigation; two-column metric grid; actions and filters wrap |
| `< 600px` | Single-column flow; records become labelled cards; all primary controls fill available width |

Use responsive page padding: `16px` on mobile, `24px` on tablet, and `32px` on desktop. No page may create horizontal viewport scrolling.

### Semantic Component States

- **Buttons:** default, hover, active, `:focus-visible`, disabled, and destructive variants are required. Minimum touch target is `44px`.
- **Inputs:** visible label, default, hover, focus, invalid, disabled, and helper/error text states are required.
- **Navigation:** active state uses color, weight, and a shape/indicator—not color alone.
- **Sidebar navigation:** use the `网申 / 网申投递助手` brand lockup and four numbered entries: `投递追踪`、`我的简历`、`数据备份`、`AI 设置`. The active entry uses a blue soft surface and white number tile.
- **Stage badges:** text always remains visible; color is secondary meaning. Compact labels stay on one line.
- **Dialogs:** preserve visible heading, labelled close control, contained scrolling, and focus visibility.
- **Loading/status:** use plain-language live status text; never communicate success or failure using an icon alone.

### Accessibility Baseline

- Meet WCAG 2.2 AA contrast for text and interactive states.
- Every interactive control is keyboard reachable and has a visible 2px focus indicator with 2px offset.
- All form controls have programmatic labels; placeholder text is supplemental only.
- Status changes use `role="status"` or `aria-live`; errors use `role="alert"` and remain adjacent to their field.
- Sticky navigation must not obscure focused content; use `scroll-padding-top` on compact layouts.
- Respect `prefers-reduced-motion: reduce` and remove non-essential transforms/animations.

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1457D9` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Primary Hover | `#0F46B6` | `--color-primary-hover` |
| On Primary Hover | `#FFFFFF` | `--color-on-primary-hover` |
| Accent/Success | `#0B7A55` | `--color-accent` |
| On Accent/CTA | `#FFFFFF` | `--color-on-accent` |
| Background | `#F5F7FA` | `--color-background` |
| Foreground | `#172033` | `--color-foreground` |
| Card | `#FFFFFF` | `--color-card` |
| Card Foreground | `#172033` | `--color-card-foreground` |
| Muted | `#F0F3F7` | `--color-muted` |
| Muted Foreground | `#677289` | `--color-muted-foreground` |
| Border | `#DCE2EC` | `--color-border` |
| Primary Soft | `#EDF4FF` | `--color-primary-soft` |
| Success Soft | `#EAF8F2` | `--color-success-soft` |
| Warning | `#9A5B06` | `--color-warning` |
| Warning Soft | `#FFF7E6` | `--color-warning-soft` |
| Destructive | `#B42318` | `--color-destructive` |
| On Destructive | `#FFFFFF` | `--color-on-destructive` |
| Destructive Soft | `#FFF0EE` | `--color-destructive-soft` |
| Ring | `#1457D9` | `--color-ring` |

**Color Notes:** Calm professional blue for navigation and primary actions; green is reserved for successful outcomes and completion actions. Text, muted text, borders, warning, and destructive colors are independently contrast-checked rather than derived through opacity.

### Typography

- **Heading Font:** Lexend
- **Body Font:** Source Sans 3
- **Mood:** corporate, trustworthy, accessible, readable, professional, clean
- **Google Fonts:** [Lexend + Source Sans 3](https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&family=Source+Sans+3:wght@300;400;500;600;700&display=swap)

**Offline CSS stack:**
```css
--font-heading: "Lexend", "Avenir Next", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
--font-body: "Source Sans 3", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
```

### Spacing Variables

*Density: 8/10 — Dense / Dashboard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` / `0.125rem` | Tight gaps |
| `--space-sm` | `4px` / `0.25rem` | Icon gaps, inline spacing |
| `--space-md` | `8px` / `0.5rem` | Standard padding |
| `--space-lg` | `12px` / `0.75rem` | Section padding |
| `--space-xl` | `16px` / `1rem` | Large gaps |
| `--space-2xl` | `24px` / `1.5rem` | Section margins |
| `--space-3xl` | `32px` / `2rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `none` | Default cards and controls remain flat |
| `--shadow-md` | `none` | Use border/color state instead of elevation |
| `--shadow-lg` | `0 12px 28px rgba(23,32,51,0.16)` | Dialogs and floating assistant only |
| `--shadow-xl` | `none` | Not used in this product |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  min-height: 44px;
  background: #1457D9;
  color: white;
  padding: 0 16px;
  border-radius: 8px;
  font-weight: 600;
  transition: background-color 180ms ease, border-color 180ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  background: #0F46B6;
}

/* Secondary Button */
.btn-secondary {
  min-height: 44px;
  background: transparent;
  color: #1457D9;
  border: 1px solid #1457D9;
  padding: 0 16px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #FFFFFF;
  border: 1px solid #DCE2EC;
  border-radius: 12px;
  padding: 16px;
  box-shadow: none;
}

.card:hover {
  border-color: #B9CFF8;
}
```

### Todo Items

- A record-level `待办` action adds the record to the upcoming rail and changes to a disabled `已待办` state while pending.
- Every pending item exposes two text actions: neutral `取消` and green `完成待办`; neither action relies on color alone.
- Cancelling or completing removes the item from the pending rail without deleting the underlying application record. The record can be added again later.
- Scheduled interviews may share the same rail, but remain independent from todo state and do not show todo actions unless the user explicitly adds that record as a todo.
- Todo actions use a minimum `44px` target, visible keyboard focus, persisted status, and a confirmation toast.

### Pipeline Filters

- The pipeline begins with `全部` and ends with `待办`; both use the same card treatment as stage filters.
- `待办` filters only records explicitly added to todo, while `全部` clears the active filter.
- Use native buttons with `aria-pressed` so every card is keyboard-operable and its selected state is announced.

### Inputs

```css
.input {
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid #8A95AA;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #1457D9;
  outline: none;
  box-shadow: 0 0 0 3px #1457D926;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border: 1px solid #DCE2EC;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-lg);
  max-width: 600px;
  width: 92vw;
}
```

---

## Style Guidelines

**Style:** Flat Design

**Keywords:** 2D, minimalist, bold colors, no shadows, clean lines, simple shapes, typography-focused, modern, icon-heavy

**Best For:** Web apps, mobile apps, cross-platform, startup MVPs, user-friendly, SaaS, dashboards, corporate

**Key Effects:** No gradients/shadows, simple hover (color/opacity shift), fast loading, clean transitions (150-200ms ease), minimal icons

### Page Pattern

**Pattern Name:** Funnel (3-Step Conversion)

- **Conversion Strategy:** Progressive disclosure. Show only essential info per step. Use progress indicators. Multiple CTAs.
- **CTA Placement:** Each step: mini-CTA. Final: main CTA
- **Section Order:** Hero > Step 1 (problem) > Step 2 (solution) > Step 3 (action) > CTA progression

---

## Motion

**Scroll Reveal** (Subtle) — Trigger: scroll (viewport enter) | Duration: 300-400ms | Easing: `power1.out`

```js
gsap.from(el, { opacity: 0, y: 12, duration: 0.35, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
```

**Framework notes:** Requires the ScrollTrigger plugin registered once via gsap.registerPlugin(ScrollTrigger); Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Keep the y offset small (8-16px) so it reads as a fade, not a slide
- ❌ Don't reveal below-the-fold content needed for SEO/crawlers as invisible-by-default without a no-JS fallback
- ⚡ toggleActions 'play none none reverse' avoids re-triggering on every scroll direction change

---

## Anti-Patterns (Do NOT Use)

- ❌ Outdated forms
- ❌ Hidden filters

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
