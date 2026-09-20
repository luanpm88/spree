# Themes: can an admin pick a theme and have the storefront change

> **Superseded in part, 13 September 2026.** `MECHANISM.md` in this directory
> measured the mechanism against real gem source and a local Spree, and corrected
> several claims below. Read it first. The corrections that touch THIS file are
> listed in its final table.

Status: **research, nothing decided, nothing built.**

This directory is the source of truth for the question. It lives in the project
on purpose: not in a chat, not in anyone's memory, not in a note outside the
repository.

| file | what it holds |
|---|---|
| `PLAN.md` | the research plan, the options, and the open questions waiting on an answer |
| `FINDINGS.md` | what has actually been measured, with the measurement beside each claim |

## The one-line state of it

The idea as sketched is a meta-driven theme system: a JSON file declares the
fields a theme exposes, the admin renders a form from it, the answers are saved
and the storefront reads them.

**Spree already ships this**, built by the company that makes Spree, and the
client has been using it for over a year. That does not settle the question, it
changes it: the question is no longer how to build one, it is which of three
routes to take given that his content already exists and his storefront no longer
reads it.

Read `FINDINGS.md` before proposing anything. Several things that look like open
questions were measured on 1 September and again on 11 September.
