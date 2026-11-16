# My deck gauntlet

This repo holds a gauntlet of Magic: The Gathering decks as plain text files. Every pull request is checked by the [TCG Gauntlet](https://github.com/flippyboy/tcg-gauntlet) validator, and the decks can be shown on a TCG Gauntlet site.

## Layout

```text
modern-2015-example/     A gauntlet: a top-level folder with a gauntlet.yaml.
  gauntlet.yaml          The gauntlet's name and format.
  gauntlet.md            A description of the gauntlet.
  burn.txt               A deck.
  burn.md                The primer for that deck.
formats/                 Custom format definitions, if you need any.
.github/workflows/       The validate workflow.
```

## Create a deck repo from this template

Make an empty folder, turn it into a git repo, and write the template into it:

```sh
mkdir my-decks && cd my-decks
git init -b main
docker run --rm -v "$PWD:/w" -w /w ghcr.io/flippyboy/tcg-gauntlet-validator:v1 init
```

On Linux the container runs as uid 1000. If your user has another uid, add `--user "$(id -u):$(id -g)"` to the `docker run` command, so that it can write to the folder.

`init` never overwrites a file that already exists. To start with another format, add `--format <ref>`, for example `--format modern` or `--format repo:formats/my-format.yaml`. The decks in the example gauntlet are only legal in 2015 Modern, so replace them if you change the format.

Then commit and push the files to GitHub, and follow the steps in [CONTRIBUTING.md](CONTRIBUTING.md) to require the `validate` check on `main`.

## Add a deck

Copy `burn.txt`, change the cards, and open a pull request. [CONTRIBUTING.md](CONTRIBUTING.md) has the details.
