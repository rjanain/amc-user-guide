# Screenshots for the user guide

`capture.mjs` takes every screenshot in `../screenshots/` by driving headless
Chrome through a test copy of the app: a demo exam from its first question to
its annotated sheets, a question bank, a second exam filled from it, the
RJ Style Paper Builder, history and trash. For each picture it also records
where the elements it names are (`<name>.json`), and writes them all to
`../screenshots/shots.tex`. The guide's red frames and badges read those
positions, so they follow the interface when the screenshots are taken again.

Run it for a new edition of the guide, then rebuild the PDF (`make`).

## What it needs

- Node 22 or later and Google Chrome (`CHROME=/path/to/chrome` if it isn't in
  the usual place); Docker.
- Python 3 with Pillow, to shrink the pictures (`optimize.py`; optional).
- A local checkout of amc-webapp, for the test copy below.

## The test copy

`stack/stack.sh up` builds and starts a copy of the portal that looks like
amc.rjana.in: shared mode with sign-in, on https://localhost:8096, the demo
account, and the school name and colour of the public server. It uses its own
images (`amc-web-guide`, `amc-auth-guide`), Docker volume and data folder, so
a copy you use for real work is not touched.

```
AMC_WEBAPP_DIR=../amc-web-ui stack/stack.sh up    # from the repository root
stack/stack.sh stop                               # when done
```

It says so when the checkout isn't at the commit in `amc-webapp.version`.
For a new edition, check out the amc-webapp version to show, take the
screenshots, and write that commit into `amc-webapp.version`.

**Never run the capture against a copy holding real exams**, and never
against the public server: its first scene deletes everything in the
account it signs in with.

## Running it

```
cd capture
node capture.mjs                 # every scene, from an empty account
node capture.mjs from:marking    # from one scene onwards
node capture.mjs check mark      # some scenes (each expects the state the previous ones leave)
```

Settings, as environment variables: `GUIDE_BASE` (https://localhost:8096),
`GUIDE_USER` and `GUIDE_PASS` (the demo account), `GUIDE_CONTAINER`
(amcguide-amc-web-1, where the scans are made), `CDP_PORT` (use a Chrome
already running with `--remote-debugging-port`).

A full run takes about six minutes. A scene that fails saves
`../screenshots/_failed.png`; a named element that isn't found is reported
(`! name: no element for key`) and the guide then draws no frame for it.

## The demo data

- `demo-questions.tex`: the eight questions of *Maths Unit Test 1*, as one
  "section as LaTeX" document.
- `students.csv`: the class list (13 students; one never sits the exam).
- `bank-questions.tex`: the *Class 8 Mathematics* bank, three groups in
  RJ style (`\element{group}{...}`).
- `make_demo_scans.py`: scans of 12 students, made in the app's container
  from the printed papers: each student has an ability and gets questions
  right or wrong accordingly, writes a name and a student number; two faint
  marks, a blank page, a page scanned late, a double tick and a mistyped
  student number give Check scans, Mark and Match students something to show.
