# Mascot runtime regression

Run `npm run dev`, then open `/tests/runtime/mascot.html` on that local server. The fixture uses the production
`MascotView`, `TutorExecution`, assistant reducer, and display buffer, with a deterministic local stream. It makes no
model API requests and uses a session document ID to avoid persistent response-cache writes. Click **Ask question**,
**Translate passage**, and **Simulate error**. Captured canvas frames show the actual poses for each assistant status.

## Inspected asset and regression

The inspected `public/mascot/nota.riv` asset had SHA-1: `af1d77bf13d49bd1df09953f2ce70dd595e1288d`.

Runtime `rive.contents.artboards` (this installed API does not expose `rive.artboardNames`) returned `new_JSON` and
`Artboard`. Both export `State Machine 1` with zero legacy inputs. On `new_JSON`, the auto-bound `ViewModel1` instance
`Instance` exports `numberProperty` of type `number`.

A browser comparison using the actual WASM runtime reproduced the regression: starting a state machine with `play()`
after initial auto-binding allowed numeric readback to change but produced no state transitions. Passing
`stateMachine: 'State Machine 1'` at construction binds the view model to that machine, producing these observed
transitions:

| Assistant status | Property value | Rive state |
| ---------------- | -------------- | ---------- |
| idle / complete  | 1              | IDLE       |
| ttft             | 4              | FLYING     |
| streaming        | 2              | HAPPY      |
| error            | 7              | CRY        |

`Scale_POP` also activates on each transition. No trigger or direct timeline playback is required. The production
wrapper captures the bound numeric property once per loaded Rive instance and updates it in an effect on mood changes.

Browser verification covered both question and translation sequences: `idle → ttft → streaming → complete`, where
complete projects back to idle, and a separate request failure. Reduced-motion mount/unmount and resumption are covered
by `tests/rive-mascot.test.tsx`.

## UI regression fixture

Open `/tests/runtime/ui.html` with Vite running to inspect production response cards, shared fields, model actions, Rive
states, and Markdown containing Persian, English, tables, code, and equations. Use the response-state and panel-width
controls to cover loading, streaming, error, cancellation, and 240px panels. Theme controls use the fixture origin's
appearance preference. No model API requests or library writes occur. These fixtures are development entry points and
are excluded from the release build.

