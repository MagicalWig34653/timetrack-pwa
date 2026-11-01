# U6 (PWA): more vertical space for the week planner (/plan)

Feedback: little vertical room is left for the planning grid, the chrome above and below eats it; use the width of big monitors.

## Change
- `/plan` page: page padding on landscape desktops (`fit`) is smaller and the max width is lifted (layout `planRoute`), page height `100dvh - 60px - 2rem`.
- Grid view is now rendered by `PlannerBoard` with three snippets from the page (`alerts`, `overview`, `saveBar`), two layouts:
  - `side` (>= 1600x640, `data-layout="side"`): the grid takes the full left column with only the tool toolbar above it. A right panel (`plan-side`, 18 rem) holds week sum, difference chip, progress, suggestion, stacked actions, grid/list switch, notice line, keyboard help, selection bar, issues/hints and, fixed at its foot, the save bar.
  - `stack` (everything else): `fit` (1280-1599 px) shows header row, summary+actions row, toolbar and the grid; notice, selection bar, help and the save bar share ONE row below the grid. Below `fit` (tablets, phones) unchanged behaviour: sticky save bar, page scrolls.
- Toolbar labels collapse to icons below 2000 px wide; "Springen zu" label hidden below 1600 px; progress bar hidden in the 1280-1599 summary row.
- List view keeps its previous layout (sticky save bar). New i18n key `wg.side_panel` (aria-label of the panel).
- Tests: new `e2e-mock/u6-plan-space.spec.ts` (grid height, no page scroll, everything in viewport, save works, axe clean at 1280x720, 1440x900, 1920x1080; phone/tablet sticky save bar). Existing tests unchanged and green.

## Grid height (week-grid element, px, mock, 2037-W20 with standard week applied)
| Viewport | Before | After |
|---|---|---|
| 1280x720 | 250 | 442 |
| 1440x900 | 518 | 622 |
| 1920x1080 | 502 | 890 (side panel) |
| 2560x1440 | 862 | 1250 |

## Verification
check 0 errors; vitest 123 files / 1263 tests passed; mock E2E 223 passed, 88 skipped (screenshot specs), 1 failed in the full run (`calendar-power` context menu on the month calendar, not touched; passes in isolation with and without this change, so load-related flake); new spec 4/4.
