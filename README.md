# AMC web portal: user guide

A step-by-step guide to the AMC web portal (amc.rjana.in) for teachers who
have never used AMC: signing in, the ten steps of an exam from the questions
to the marked answer sheets, choosing a template, question banks, history and
trash, common problems, and a printable checklist. Every step is shown on
annotated screenshots of a demo exam.

**Get the PDF** at <https://rjana.in/amc/guide.pdf>, which always gives the
newest edition, or from the [Releases](../../releases) page: each edition is
built from its tag by GitHub Actions.

The portal itself is [amc-webapp](https://github.com/rjanain/amc-webapp), our
version of the AMC team's web app. This repository only holds the guide.

## What is here

| | |
|---|---|
| `user-guide.tex` | The guide. |
| `amcguide.sty` | Its look, and the macros that draw the red frames and numbered badges on the screenshots (described at the top of the file). |
| `screenshots/` | The pictures, with `shots.tex`: where each framed element is on them. |
| `capture/` | The script that takes the screenshots, the demo exam, class list, bank and scans ([capture/README.md](capture/README.md)). |
| `stack/` | Starts the test copy of the portal the screenshots are taken on. |
| `demo/` | The public demo portal: its sample exams, nightly reset and limits ([demo/README.md](demo/README.md)). |
| `amc-webapp.version` | The amc-webapp commit this edition shows (printed on the cover). |

## Building the PDF

TeX Live with latexmk, pdflatex and the Inter font package:

```
make            # user-guide.pdf
make clean
```

## Editions

The guide describes one version of the portal. It is refreshed on purpose,
when a release changes what teachers see, not after every change:

1. Check out the amc-webapp version to show, and start the test copy:
   `AMC_WEBAPP_DIR=../amc-web-ui stack/stack.sh up`.
2. Take the screenshots again: `cd capture && node capture.mjs` (about six
   minutes). Fix any scene the new interface breaks, and the text where
   the interface changed.
3. Write the amc-webapp commit into `amc-webapp.version`, update
   `\edition` in `user-guide.tex`, and check the PDF page by page.
4. Commit, then tag the edition (`git tag v2026.11 && git push --tags`):
   the workflow builds the PDF and publishes it as a release.

Pushes and pull requests build the PDF too (as a workflow artifact), so a
LaTeX mistake shows before tagging.

## The demo account

The guide prints the shared account of the demo portal, amc-demo.rjana.in
(`demo_instructor`). Anyone with the guide can sign in with it, so it must never
hold real students' data, and it goes back to the start every night. See
[demo/README.md](demo/README.md).

## Licence

The guide's text, style and pictures: [CC BY 4.0](LICENSE). The scripts in
`capture/` and `stack/`: [MIT](LICENSE-MIT). The screenshots show amc-webapp,
which is free software under the GNU AGPL; AMC itself is under the GNU GPL.
