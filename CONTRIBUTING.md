# Contributing

Thanks for your interest in improving this Ulanzi Studio plugin! Issues and pull
requests are welcome.

## Development setup

This project uses [mise](https://mise.jdx.dev/) to manage the Node toolchain and
common tasks.

```shell
mise trust      # trust this project's mise.toml (first time only)
mise install    # install the pinned Node toolchain
mise run setup  # fetch the vendored Ulanzi SDK + install npm dependencies + git hooks
```

See the [README](./README.md) for the project layout, on-device testing, and
debugging instructions.

## Formatting & linting

```shell
mise run fmt    # auto-format & fix: Biome (JS/HTML/JSON) + markdownlint
mise run lint   # check without writing (run this before committing)
```

Formatting and linting also run automatically on commit via
[lefthook](https://github.com/evilmartians/lefthook) (installed by
`mise run setup`). Please do not ignore linter warnings.

## Commit messages

Commit messages follow the [cz-emoji](https://github.com/streamich/git-cz)
convention:

```plain
<type>: <:emoji-code:> <subject>
```

- No scope.
- Subject is 72 characters or fewer.
- Emojis are written as text codes (e.g. `:sparkles:`) and render on GitHub.

| type     | code                  |
|----------|-----------------------|
| feat     | `feat: :sparkles:`    |
| fix      | `fix: :bug:`          |
| wip      | `wip: :construction:` |
| chore    | `chore: :paperclip:`  |
| style    | `style: :art:`        |
| docs     | `docs: :notebook:`    |
| perf     | `perf: :zap:`         |
| refactor | `refactor: :bulb:`    |
| test     | `test: :100:`         |
| release  | `release: :tada:`     |

## Branching & pull requests

- Do **not** commit directly to `main`. Create a branch and open a pull request.
- Keep changes focused and ensure `mise run lint` passes.
- When relevant, please include the environment you tested on (OS, Ulanzi deck
  model, Key Light model) — the maintainer has only been able to test on a single
  setup (see the note in the README).

## Updating the vendored SDK

The Ulanzi SDK is vendored and pinned by commit SHA. See
[Updating the SDK](./README.md#updating-the-sdk) in the README for the procedure.
