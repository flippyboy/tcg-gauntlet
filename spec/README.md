# TCG Gauntlet specifications

These documents define the files that a deck repo contains and the rules that a checker applies to them. They are normative: a tool that reads them is expected to behave as written. The words MUST, MUST NOT, SHOULD and MAY are used in their usual specification sense.

For the reasons behind these rules, see the [design document](../docs/designs/tcg-gauntlet.md). Nothing in this folder depends on it.

## Documents

| Document                                     | Defines                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [deck-file.md](deck-file.md)                 | The deck file: encoding, front matter, section headers, card lines, comments, name matching and printing choice. |
| [gauntlet.md](gauntlet.md)                   | The deck repo layout, `gauntlet.yaml`, sidecar files, URLs, limits and the deck repo URL grammar.                |
| [format-definition.md](format-definition.md) | Format definitions, the card pool, official formats, deck rules and format keys.                                 |
| [error-codes.md](error-codes.md)             | The stable error and warning codes, how schema errors map to them, and the validator exit codes.                 |

## JSON Schemas

The schemas are JSON Schema draft 2020-12. They are the single source of the structural rules for the three YAML inputs. A tool MUST NOT add structural rules for these files that the schemas do not contain.

| Schema                                                                       | Checks                           |
| ---------------------------------------------------------------------------- | -------------------------------- |
| [deck-front-matter.v1.schema.json](schemas/deck-front-matter.v1.schema.json) | The front matter of a deck file. |
| [gauntlet.v1.schema.json](schemas/gauntlet.v1.schema.json)                   | `gauntlet.yaml`.                 |
| [format-definition.v1.schema.json](schemas/format-definition.v1.schema.json) | A format definition file.        |

The presets that ship with the tool are in [../presets](../presets/README.md).

## Schema versions

Deck front matter, `gauntlet.yaml` and format definitions each carry an integer field `schema_version`.

- Version 1 is the only version.
- A missing `schema_version` means 1 in deck front matter and in `gauntlet.yaml`. A format definition must state it (see [format-definition.md](format-definition.md)).
- A value that is an integer other than a version the tool knows gives `E-SCHEMA-VERSION`. A value that is not an integer gives `E-SCHEMA-INVALID`.
- A file with a newer version than the tool knows is an error for its whole gauntlet. A tool MUST NOT show or check part of that gauntlet.
- Once version 2 exists, tools support the current version and the one before it.
- A breaking change to a schema, to the error codes or to the rules in these documents is a new major version of the tool.

## Checking order for YAML files

For deck front matter, `gauntlet.yaml` and format definitions, a tool does these steps in order and stops at the first step that fails for that file:

1. Parse the YAML with the limits in [gauntlet.md](gauntlet.md). A YAML error is `E-PARSE-FRONTMATTER` for front matter, and `E-SCHEMA-INVALID` for the other two files.
2. Check `schema_version`.
3. Check the document against its JSON Schema, and report the errors as described in [error-codes.md](error-codes.md).
4. Fill in the defaults the schema names.
