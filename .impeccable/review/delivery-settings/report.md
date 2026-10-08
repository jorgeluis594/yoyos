# Delivery settings — final handoff

Approved option A places pickup, home delivery and agency in three open native groups and keeps Save in a separate footer above native tabs. Exactly three inspected raster alternatives, their prompts and approval sidecars are in `../../mocks/delivery-settings/`. Existing fields, zones, courier controls, translations, validation, conflicts and persistence contracts remain intact; no global tokens or components changed.

## Native evidence

All PNGs here were captured from the assigned Samsung A56 through adb, rather than generated. The reproduction checkpoint is `android-light-top.png`; `android-light-bottom.png` includes successful save feedback. The `android-dark-large-{top,home,agency,bottom}.png` captures show dark mode at font scale 1.3, physical 1080×2340 and density 450, with the footer visible above native tabs.

`android-dark-large-keyboard.png` is pre-final-adjustment evidence: Save is hidden while the native keyboard is open. The final Android KeyboardAvoidingView behavior changed from `height` to undefined to delegate resizing to Android; this adjustment was not tested or recaptured because the user explicitly ended expanded QA. The coordinator accepted access after closing the keyboard as the required scope. iOS/tablet were not checked; large-text truncation of the shared native configuration-tab label remains outside this screen.

## Checks actually run

- Configured mobile full test suite: passed on second run, original timeouts. First run had five unrelated timeouts under concurrent load; no foreign tests or timeouts changed.
- After Android inset correction: focused existing delivery-settings-screen suite passed, mobile typecheck passed, mobile lint passed with zero errors and three baseline warnings.
- Android development bundle returned HTTP 200; native unchanged Save displayed success.
- These checks precede the final one-line Android keyboard adjustment. No additional checks were run after the user's stop instruction.

## Finish review

Independent reviewer `/root/delivery_finish_review` returned `fix`, identifying keyboard visibility and incomplete final documentation. This report and the local surface brief close the documentation items; keyboard behavior remains explicitly unverified after its minimal adjustment. No second reviewer round or unrestricted ship claim is made. Asset producer found an empty production raster manifest: the implementation uses native controls exclusively.

## Environment handoff

Metro on port 8082 was stopped. Samsung restored to font_scale 1.0 and night no, with physical resolution 1080×2340/density 450 and no overrides; USB stay-awake setting 2 retained. Device released. Worktree, reference symlink and artifacts retained; no push/merge.

Authorized isolated QA fixtures remain available: courier `74c23878-6eba-4f37-9dcd-c2a5ac7d871e`, home zone `e2a0d7b0-5dd6-4165-87ff-cd4cbad5e4db` (S/8), agency zone `d4ca847d-a1f5-4d18-991a-120286c7ff7f` (S/12), both with districts 150101/150122. Pickup is Tienda principal QA, Av. Lima 123. No credentials are included.
