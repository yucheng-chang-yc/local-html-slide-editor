# Third-party notices

Direct dependency versions are pinned in `package.json`, with the complete transitive resolution locked by `pnpm-lock.yaml`. Each dependency retains its upstream license and copyright.

| Package | Exact version | Purpose | Upstream / provenance | License |
|---|---:|---|---|---|
| `@vitejs/plugin-react` | 6.0.3 | React build plugin | npm / `vitejs/vite-plugin-react` | MIT |
| `express` | 5.2.1 | localhost server | npm / `expressjs/express` | MIT |
| `jszip` | 3.10.1 | ZIP import/export | npm / `Stuk/jszip` | MIT or GPL-3.0-or-later |
| `parse5` | 8.0.1 | HTML parsing | npm / `inikulin/parse5` | MIT |
| `react` | 19.2.7 | client UI | npm / `facebook/react` | MIT |
| `react-dom` | 19.2.7 | client rendering | npm / `facebook/react` | MIT |
| `vite` | 8.1.5 | build/dev server | npm / `vitejs/vite` | MIT |
| `@eslint/js` | 10.0.1 | lint rules | npm / `eslint/eslint` | MIT |
| `@playwright/test` | 1.61.1 | browser tests | npm / `microsoft/playwright` | Apache-2.0 |
| `@types/express` | 5.0.6 | TypeScript definitions | npm / `DefinitelyTyped/DefinitelyTyped` | MIT |
| `@types/node` | 26.1.1 | TypeScript definitions | npm / `DefinitelyTyped/DefinitelyTyped` | MIT |
| `@types/react` | 19.2.17 | TypeScript definitions | npm / `DefinitelyTyped/DefinitelyTyped` | MIT |
| `@types/react-dom` | 19.2.3 | TypeScript definitions | npm / `DefinitelyTyped/DefinitelyTyped` | MIT |
| `concurrently` | 10.0.3 | local process runner | npm / `open-cli-tools/concurrently` | MIT |
| `eslint` | 10.7.0 | lint | npm / `eslint/eslint` | MIT |
| `eslint-plugin-react-hooks` | 7.1.1 | React lint rules | npm / `facebook/react` | MIT |
| `globals` | 17.7.0 | lint globals | npm / `sindresorhus/globals` | MIT |
| `tsx` | 4.23.1 | TypeScript runtime | npm / `privatenumber/tsx` | MIT |
| `typescript` | 5.9.3 | compiler | npm / `microsoft/TypeScript` | Apache-2.0 |
| `typescript-eslint` | 8.65.0 | TypeScript lint | npm / `typescript-eslint/typescript-eslint` | MIT |
| `vitest` | 4.1.10 | unit/integration tests | npm / `vitest-dev/vitest` | MIT |

## Transitive inventory

Run:

```bash
corepack pnpm@11.9.0 run verify:licenses
```

The command generates a machine-readable inventory for the installed dependency graph under the ignored local verification-output directory. Package-specific license text remains available in each installed package and its upstream distribution.
