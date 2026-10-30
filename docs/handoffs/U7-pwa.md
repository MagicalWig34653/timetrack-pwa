# U7-pwa: module switches

Module on/off controls are now real switches (new `src/lib/components/ui/switch`, a native `input type=checkbox role=switch` with a drawn track and thumb; no bits-ui in the project, so the existing checkbox pattern was followed).

- Keyboard (Space), label/aria-label association, disabled state and `checked`/`aria-checked` come from the native input; focus ring via `peer-focus-visible`; light and dark tokens.
- The hit area extends 8px around the 44x24 track (about 60x40) so it works as a touch target.
- Replaced in: `settings/modules`, `admin/modules`, onboarding module step. Test ids and German labels unchanged.
- Other on/off-style checkboxes left as they are (not module toggles): notifications (in-app/push per category, quiet hours, only-unread), appearance, storage S3 path style, day "skip fixed breaks", work model rounding/travel, onboarding rounding, stats "rounded", sharing scope grid, trigger-link actions.
- Tests: `switch.test.ts` (new); module page tests already used `role=switch` selectors.
