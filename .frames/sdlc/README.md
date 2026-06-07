# SystemOS

This project uses SystemOS to coordinate design decisions, tasks, and
artifacts across multiple sessions and contributors.

If you are new to SystemOS, install the tool and run `systemos --help`
to learn the basics. This README orients you to what SystemOS knows
about *this project*; it does not teach SystemOS itself.

## What lives here

- `proposals/draft/` — proposals being written, not yet decided.
- `proposals/accepted/` — proposals that have been accepted and are
  either being planned or already in flight.
- `proposals/rejected/` — proposals that were declined.
- `.project` — a small marker file that identifies this directory as a
  SystemOS-managed project. The marker is gitignored on purpose: each
  contributor's local registration is their own consent, and nothing
  inside the marker needs to be shared across the team.

Other subdirectories appear here as you and your collaborators produce
artifacts that need them. They are not present on a fresh skeleton.

## Where to start

If you've just cloned this repo and want to participate:

1. Install SystemOS — see `systemos --help` once installed.
2. Register this project locally: `cd <repo-root> && systemos add .`
   This is a one-time registration. It writes a marker file inside
   `.frames/sdlc/` and adds this project to your local SystemOS
   install. It does not modify Claude Code globally beyond what the
   SystemOS install already wired (one user-scope hook entry, scoped
   to Claude Code only).
3. Open the SystemOS IDE: `systemos ui`.

If you want to read what has been decided so far, browse
`proposals/accepted/` — those are the methodology-shaped decisions
this project has committed to. The project's main README (at the repo
root) covers the project itself.
