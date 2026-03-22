# Pablay — Agent Setup

## Setup

```bash
test -d .pablay || pablay init
```

## Identity

```bash
export PABLAY_AUTHOR=<agent-name>
```

## Session Start

```bash
pablay feed --json
```

## Core Patterns

```bash
pablay list --type task --status draft --json
pablay show <id> --json
pablay update <id> --status open
pablay start <id>
```

```bash
pablay create note --title "Progress: <what you did>" --channel <channel>
```

```bash
pablay complete <id>
```

## Channels

```bash
pablay channels
pablay feed --channel <channel> --json
pablay list --channel <channel> --json
```
