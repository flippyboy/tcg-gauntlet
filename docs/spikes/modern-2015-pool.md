# Spike 2: 2015 Modern pool check

Run on 2026-11-15 against MTGJSON `5.3.0+20261115` and the live Scryfall API. Scripts: `spikes/modern-2015-pool/fetch-site-pool.ts`, `spikes/modern-2015-pool/compare.ts`. Reference list: `spikes/modern-2015-pool/site-pool.txt`.

## Result

**Acceptance criterion met: zero unexplained differences, and in fact zero differences.** The pool built from MTGJSON for the 49 sets in item 22 (including TSB), minus the 32-card banlist, with the pool rule from "Format-definition schema v1", is **identical** to the reference pool name by name: 9,186 names on each side, 0 only in MTGJSON, 0 only in the reference.

- **TSB is required to match the site.** Without TSB the MTGJSON pool has 9,067 names and is missing 119 cards that the site's query includes (all of them have TSB as their only printing in the set list).
- **The design's premise about TSB is wrong for current data.** TSB (Time Spiral Timeshifted) has set type `expansion` in both MTGJSON (`sets.type`) and Scryfall (`set_type`), so the site's query `st:core or st:expansion` includes it. TSB is not an exception to the type rule. The set list in item 22 is exactly the set of all MTGJSON sets with `type IN ('core','expansion')` and `releaseDate` from 2003-07-28 (8ED) to 2015-07-17 (ORI): 49 sets (10 core, 39 expansion), no more and no fewer. No `include` or `exclude` entries are needed.
- The banlist of 32 is confirmed against MTGJSON (every name exists with that exact spelling and is in the pool before banning). Golgari Grave-Troll is in the pool.
- One defect in the site: the Scryfall link on 2015modern.com's Legal Sets page excludes only 31 cards. **Cloudpost is missing from the link's `-name:` list**, although the site's own Banned Cards page lists it. The site's own search result therefore contains Cloudpost. I removed all 32 on the reference side, as the task specified. If the author wants the preset to match the site's search result literally, Cloudpost would differ; the Banned Cards page and the stated banlist say it is banned, so the preset keeps it banned.

## Method

Reference source: Scryfall's search API, using the query linked from `https://www.2015modern.com/legal-sets` ("CARD POOL ON SCRYFALL" link; the link's full query also appends one `-name:"..."` exclusion per banned card). The API was reachable; no fallback was needed.

```
node spikes/modern-2015-pool/fetch-site-pool.ts
  GET https://api.scryfall.com/cards/search?q=(st:core or st:expansion) date>=8ed date<=ori&unique=cards&order=name
  headers: User-Agent: tcg-gauntlet-spike/0.1, Accept: application/json; 120 ms between pages; follows next_page
  -> 53 pages, total_cards 9,218 = 9,218 distinct names fetched
  -> removes the 32 banned names (32 of them were present) -> 9,186 names -> spikes/modern-2015-pool/site-pool.txt
node spikes/modern-2015-pool/compare.ts                 # TSB kept
node spikes/modern-2015-pool/compare.ts --no-tsb        # sensitivity
node spikes/modern-2015-pool/compare.ts --english-only  # sensitivity
```

`compare.ts` implements the pool rule on the real MTGJSON file (read-only):

```sql
SELECT DISTINCT c.name FROM cards c
WHERE c.setCode IN (<49 codes from item 22>)
  AND COALESCE(c.isFunny,0)=0 AND COALESCE(c.isOnlineOnly,0)=0 AND COALESCE(c.isOversized,0)=0
```

then subtracts the 32 banned names, then diffs against `site-pool.txt`. The raw Scryfall response (with set and set type per card) was saved to `spikes/mtgjson-size/out/scryfall-raw.json` (git-ignored). I also read 2015modern.com's Legal Sets and Banned Cards pages (saved as `spikes/mtgjson-size/out/site-*.html`).

What the site says: "Cards from all regular core sets and expansions between Eighth Edition and Magic Origins are legal. No new cards will be added to the card pool." The Legal Sets page lists the 49 sets by name (Eighth Edition through Magic Origins, including Time Spiral, Planar Chaos and Future Sight; it does not list Timeshifted as a separate line, but its query includes it). The Banned Cards page says "2015 Modern follows the banlist of Modern at the time of Magic Origins. No changes are planned." and lists 32 cards by Scryfall card links.

## Diff

| | Names |
|---|---|
| MTGJSON pool, 49 sets (TSB kept), minus 32 banned | 9,186 |
| Scryfall reference (`site-pool.txt`), minus 32 banned | 9,186 |
| Only in MTGJSON | 0 |
| Only in reference | 0 |

Per-difference classification: there are no differences, so there is nothing to classify as promo-only, naming, set-type or similar. The checks that could have produced differences, and what they found:

| Possible cause | Check | Result |
|---|---|---|
| TSB timeshifted cards | Remove TSB from the set list. | 119 cards drop out (9,186 to 9,067), all present in the reference. TSB has 121 distinct names; 2 of them (Dragon Whelp, Tormod's Crypt) also have printings in other listed sets. TSB is **needed**. |
| Set type differences | MTGJSON `sets.type` for the 49 codes. | 10 `core`, 39 `expansion`; the 49 codes equal the type-and-date range exactly. Scryfall reports TSB as `expansion`. |
| Promo-only names | Pool with and without `isPromo` printings. | No effect (listed sets contain no `isPromo=1` rows). Promo sets such as `PTSP` (Time Spiral Promos, parent TSP) are not in the list, so not in the pool. |
| Funny, online-only, oversized | Pool with and without the three exclusions. | No effect on the name set. (26 `isOnlineOnly` rows exist in listed sets, 24 of them Khans of Tarkir Arena-only rows, 1 an Eighth Edition MTGO-only row; the filters change no name, so every such card also has a normal printing or is not otherwise relevant.) |
| Non-English printings | `--english-only`. | No effect (0 pool names lack an English printing). |
| Split, double-faced, flip, accent naming | Compare names verbatim. | None differ. MTGJSON `name` equals Scryfall `name` (`A // B`) for all of the 87 multi-face names in the pool; 5 names with non-ASCII characters (Jötun Grunt, Jötun Owl Keeper, Lim-Dûl the Necromancer, Séance, Dandân) match exactly. |
| Banned names | Every name exists in `cards` and in the pool before banning. | See below. |

The 119 TSB-only names (their only printing in the 49 sets is in TSB):

Akroma, Angel of Wrath; Arena; Assault // Battery; Auratog; Avalanche Riders; Avatar of Woe; Avoid Fate; Bad Moon; Browbeat; Call of the Herd; Celestial Dawn; Claws of Gix; Coalition Victory; Cockatrice; Consecrate Land; Conspiracy; Craw Giant; Dandân; Darkness; Dauthi Slayer; Defiant Vanguard; Desert; Desolation Giant; Disenchant; Disintegrate; Dodecapod; Dragonstorm; Enduring Renewal; Eron the Relentless; Essence Sliver; Evil Eye of Orms-by-Gore; Faceless Butcher; Feldon's Cane; Fiery Justice; Fiery Temper; Fire Whip; Flying Men; Funeral Charm; Gaea's Blessing; Gaea's Liege; Gemstone Mine; Ghost Ship; Giant Oyster; Goblin Snowman; Grinning Totem; Hail Storm; Honorable Passage; Hunting Moa; Icatian Javelineers; Jasmine Boreal; Jolrael, Empress of Beasts; Kobold Taskmaster; Krosan Cloudscraper; Leviathan; Lightning Angel; Lord of Atlantis; Merfolk Assassin; Merieke Ri Berit; Mindless Automaton; Mirari; Mistform Ultimus; Moorish Cavalry; Mystic Enforcer; Mystic Snake; Nicol Bolas; Orcish Librarian; Orgg; Ovinomancer; Pandemonium; Pendelhaven; Pirate Ship; Prodigal Sorcerer; Psionic Blast; Resurrection; Sacred Mesa; Safe Haven; Scragnoth; Sengir Autocrat; Serrated Arrows; Shadow Guildmage; Shadowmage Infiltrator; Sindbad; Sol'kanar the Swamp King; Soltari Priest; Soul Collector; Spike Feeder; Spined Sliver; Spitting Slug; Squire; Stormbind; Stormscape Familiar; Stupor; Suq'Ata Lancer; Swamp Mosquito; Teferi's Moat; Thallid; The Rack; Thornscape Battlemage; Tribal Flames; Twisted Abomination; Uncle Istvan; Undead Warchief; Undertaker; Unstable Mutation; Uthden Troll; Valor; Verdeloth the Ancient; Vhati il-Dal; Void; Voidmage Prodigy; Wall of Roots; War Barge; Whirling Dervish; Whispers of the Muse; Wildfire Emissary; Willbender; Witch Hunter; Withered Wretch; Zhalfirin Commander

## Banlist check

Checked with `compare.ts`: all 32 names exist in MTGJSON with the exact spelling used in item 22, there are no duplicates, and all 32 are in the pool before banning (so each ban removes a real card; none is a typo that would silently do nothing). Golgari Grave-Troll is in the pool (printings in RAV and others). The 2015modern.com Banned Cards page lists the same 32 cards (compared by card-link slug; the apostrophe names Green Sun's Zenith, Sensei's Divining Top and Umezawa's Jitte matched after allowing for apostrophes). The Scryfall link on the Legal Sets page has 31 exclusions (Cloudpost is missing).

Not verified: the banlist history itself (that the Modern banlist on 2015-01-19 was exactly these 32). I relied on the site's Banned Cards page and the author's statement; no independent source for the January 2015 announcement was consulted. MTGJSON has no historical legalities.

## Implications for the design

1. **Item 22 and the `sets` list.** Keep TSB. Delete the sentence "It is removed before `@1` is released if spike 2 shows that 2015modern.com leaves it out", and replace the justification with: "TSB has set type `expansion` in MTGJSON and Scryfall, so `st:expansion` includes it; verified in spike 2." The comment in the preset can cite `spec: all MTGJSON sets with type core or expansion, 2003-07-28 to 2015-07-17`.
2. **Item 2 and "Known item to check".** Replace "Its set type is not `core` or `expansion`" with the finding: TSB's type is `expansion`. The spike is closed with 0 differences, so `site-pool.txt` (9,186 names, banned cards removed) can be checked in as the reference; `compare.ts` is the regression test.
3. **No `include`/`exclude` entries and no rule change** are needed for `2015-modern@1`. The pool rule as written (listed set, not `isFunny`/`isOnlineOnly`/`isOversized`, tokens excluded because MTGJSON keeps them in a separate table) is sufficient. The `isPromo` and language conditions make no difference for this preset, so I do not recommend adding rules for them. (See the mtgjson-size spike for the NULL-boolean pitfall: use `COALESCE(col,0)=0`.)
4. **Add a conformance test** (item 2, or the preset tests in Phase 2): build the pool for `preset:2015-modern@1` from a pinned MTGJSON file and compare with `site-pool.txt`. Because the MTGJSON file is not archived, the test needs a snapshot of the `cards` rows in the 49 sets, or it runs against the live file in the canary workflow (item 13) and reports a diff as a warning, not a failure. If MTGJSON retypes a set or Scryfall changes, the diff shows it.
5. **Note the site defect** (Cloudpost missing from the site's Scryfall link) in `presets/README.md` or a comment in the preset, so that nobody later "fixes" the preset to match the link.
6. **R10** can be downgraded from "Medium": the measured pool matches. Keep it for MTGJSON drift.
7. **`spikes/modern-2015-pool/site-pool.txt`** holds 9,186 names, one per line, sorted, with the 32 banned names already removed. It is derived from the Scryfall response on 2026-11-15; the Scryfall total with bans was 9,218.

## Open issues

- The Scryfall query is evaluated by Scryfall at fetch time (2026-11-15); it can change if Scryfall retypes a set or changes a release date. The reference is a snapshot.
- The January 2015 banlist content was taken from the site and the author, not independently verified (see above).
- Only names were compared. Whether the site's search shows the same printings, collector numbers or default printings was not checked. The default printing for a 2015 Modern card that is only in TSB is its TSB printing (for example Akroma, Angel of Wrath resolves to TSB#1), which is correct for the rule but looks odd to users; that is a display matter for the app, not for legality.
- The Cloudpost discrepancy means the site's own search page shows one banned card; this was not confirmed by loading the site's search UI.
- Pool membership by name was confirmed. Per-card legality edge cases (cards that need a name-based `restricted` or `include`) do not occur in this preset.
