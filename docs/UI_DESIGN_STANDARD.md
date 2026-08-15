# UI Design Standard
This is the default product UI standard for Sales Dashboard.
Use it whenever this repository creates, redesigns, or materially changes a user-facing interface.

## Design Objective
Create interfaces that feel like clear, high-value SaaS products:
- simple enough for a non-technical user to understand in seconds
- structured around real workflows, not decorative landing-page filler
- premium, calm, and efficient
- easy to scan, filter, compare, and act on

## Default Product Surface
- Build the actual usable screen first.
- Use plain, customer-facing labels instead of internal field names.
- Group related information into clear sections.
- Put key outcomes in compact metric cards.
- Use badges for status: green success, amber warning, red error, grey neutral.
- Keep advanced details, logs, raw payloads, and diagnostics collapsed by default.
- Show loading, empty, success, warning, and error states.

## Visual System
- Font: Inter or a modern system sans-serif fallback.
- Spacing: 8px grid with consistent 16-24px section padding.
- Radius: 8px for cards, panels, controls, and repeated items unless an existing design system says otherwise.
- Palette: neutral base with one restrained accent color plus semantic status colors.
- Depth: subtle borders and soft shadows, never heavy decoration.
- Motion: short hover and loading transitions that clarify feedback.

## Layout Rules
- Prefer dashboards, workbenches, tables, side panels, tabs, filters, and toolbars for operational apps.
- Avoid marketing heroes unless the product genuinely needs a landing page.
- Do not nest cards inside cards.
- Do not use decorative orbs, bokeh blobs, or gradient-only backgrounds.
- Make navigation obvious and keep the current page visible.
- Keep text inside controls and panels at stable, readable sizes; do not scale font size with viewport width.
- Use responsive constraints so tables, grids, boards, counters, and toolbars do not shift unexpectedly.

## Interaction Rules
- Use icons for common actions when the project has an icon set available.
- Prefer familiar controls: toggles for binary choices, sliders or inputs for numbers, menus for option sets, tabs for views.
- Make primary actions clear, but avoid flooding screens with competing buttons.
- Keep destructive or irreversible actions visually distinct and confirm when needed.
- Give every data-table column heading a concise plain-language description available on hover and keyboard focus. Explain denominators, provenance, limitations, and ambiguous workflow terms where relevant.

## Verification
Before finishing UI work:
- run the real local app or the nearest runnable preview
- check desktop and mobile widths
- confirm text does not overlap or overflow
- confirm loading, empty, error, and populated states are understandable
- keep screenshots or verification notes when the change is visual or workflow-heavy
