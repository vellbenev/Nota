# Nota Rive mascot

`nota.riv` is **Character poses** by **avocadenko**, distributed under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

- Source: [Character poses on Rive Marketplace](https://rive.app/marketplace/28745-54500-character-poses/)
- Creator: [avocadenko](https://rive.app/@avocadenko/)
- Integration: stored as `nota.riv`; Nota maps assistant states to the asset's existing numeric property.
- No artwork edits were made during this repository cleanup. Earlier asset modification history is not recorded.

This asset retains its CC BY 4.0 license and is excluded from the source code's MIT license.
Retain the creator credit, source and license links, and identify any changes when redistributing it.
See [third-party notices](../../THIRD_PARTY_NOTICES.md).

## Runtime contract

Vite selects the alphabetically first `.riv` file in this directory at build time. Restart Vite
or rebuild after replacing it. The current adapter expects:

| Element | Name |
| --- | --- |
| Artboard | `new_JSON` |
| State machine | `State Machine 1` |
| Auto-bound view model | `ViewModel1` / `Instance` in the bundled asset |
| Numeric property | `numberProperty` |

| Assistant mood | Property value | Observed pose |
| --- | --- | --- |
| Idle / complete / cancelled | 1 | IDLE |
| Pondering / waiting | 4 | FLYING |
| Explaining / streaming | 2 | HAPPY |
| Error | 7 | CRY |

The state machine is selected during runtime construction, before automatic view-model binding.
Starting it afterward can update numeric readback without animating the pose. The adapter uses
data binding, rather than legacy state-machine inputs. If a replacement asset uses different
names or values, update `src/features/mascot/RiveMascot.tsx` and its regression coverage together.

Embed all fonts and images in the `.riv` file. External asset loading is disabled and Rive WASM
is bundled locally. Missing assets, invalid contracts, runtime errors or load timeouts restore
the SVG fallback. Reduced-motion users always receive a static SVG posture and accessible state badge.

Use the [browser regression harness](../../tests/runtime/README.md) to verify an actual asset.
