# Authored inventory-export seed

`seed/src/exporter.mjs` is the original template, kept outside any mutable candidate directory. Later run admission copies it into that run's registered candidate; the template must never be registered as the Builder's writable workspace.

The seed deliberately preserves input timestamp text instead of normalizing UTC with millisecond precision. This is an authored defect, not an observed model mistake. It makes the initial mixed-offset case fail the manifest's expected CSV. It otherwise implements the public validation, age, sorting and CSV rules. The public specification remains `archive/plans/contracts/fixture-manifest.json`.

M02 tests execute authored cases directly to demonstrate the defect. They are development evidence, not protected checker receipts or accepted completion. The protected service checker remains M08.
