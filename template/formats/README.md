# Custom formats

A gauntlet can use a format that is not a preset or an official format. Put its definition in this folder as `formats/<name>.yaml`, then set `format: repo:formats/<name>.yaml` in the gauntlet's `gauntlet.yaml`.

Only files that end in `.yaml` are read. The full rules are in [format-definition.md](https://github.com/flippyboy/tcg-gauntlet/blob/main/spec/format-definition.md).

## Example

Save this as `formats/example-cube.yaml` to try it. The lines that start with `#` are comments.

```yaml
# The format's version. It must be 1.
schema_version: 1

# A short identifier: lower-case letters, digits and hyphens.
id: example-cube

# The name people see.
name: Example Cube

# Legality is decided by card name. This is the only value in version 1.
legality_by: name

# A card is in the pool when it has a printing in one of these sets.
sets: [LEA, LEB, 2ED, 3ED]

# Cards that are never legal.
banned:
  - Black Lotus

# Cards that are legal, but at most 1 copy is allowed.
restricted:
  - Ancestral Recall

# Cards that are in the pool even though no listed set prints them.
include:
  - name: Lightning Bolt
    reason: Added by hand for this cube.

# Cards that are left out of the pool even though a listed set prints them.
exclude:
  - name: Mox Pearl
    reason: Too strong for this cube.

# Deck size and copy limits. Every field is optional. The defaults are
# min_main 60, no max_main, max_sideboard 15 and max_copies 4.
deck:
  min_main: 40
  max_main: 60
  max_sideboard: 15
  max_copies: 1
  copy_exempt: [basic_lands, any_number_text]
```

The validator checks that every card name in `banned`, `restricted`, `include` and `exclude` is a real card, and reports `E-FORMAT-INVALID` if one is not.
